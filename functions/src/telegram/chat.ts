import * as admin from "firebase-admin";
import { queryWithFileSearch } from "../services/gemini";
import { summarizeSession } from "../services/summarize";
import {
  TELEGRAM_SESSION_TTL_MS,
  TELEGRAM_DEFAULT_MODEL,
  SUMMARIZATION_THRESHOLD,
  SUMMARIZATION_COOLDOWN_MS,
} from "../config";
import { sendMessage, sendChatAction, streamResponse } from "./telegramClient";
import { checkRateLimit } from "./rateLimiter";
import { chatStates, getLink } from "./commands";
import type { TelegramLink } from "./types";

function db() {
  return admin.firestore();
}

/** Parse /web, /maps, /url slash commands from Telegram messages */
const TELEGRAM_SLASH_COMMANDS: Record<string, string> = {
  "/web ": "googleSearch",
  "/maps ": "googleMaps",
  "/url ": "urlContext",
};

function parseSlashCommand(text: string): { query: string; toolOverride?: string } {
  const lower = text.toLowerCase();
  for (const [prefix, tool] of Object.entries(TELEGRAM_SLASH_COMMANDS)) {
    if (lower.startsWith(prefix)) {
      return { query: text.slice(prefix.length).trim(), toolOverride: tool };
    }
  }
  return { query: text };
}

export async function handleChatMessage(chatId: number, text: string): Promise<void> {
  // 1. Check link
  const link = await getLink(chatId);
  if (!link) {
    await sendMessage(chatId, "You're not linked yet. Send /start to connect your account.");
    return;
  }

  // 2. Check active notebook
  const notebookId = link.activeNotebookId;
  if (!notebookId) {
    await sendMessage(chatId, "No notebook selected. Use /notebooks to see your list, then /switch <number> to pick one.");
    return;
  }

  // 3. Rate limit
  const rateResult = checkRateLimit(chatId);
  if (!rateResult.allowed) {
    const seconds = Math.ceil((rateResult.retryAfterMs ?? 5000) / 1000);
    await sendMessage(chatId, `You're sending messages too fast. Please wait ${seconds} seconds.`);
    return;
  }

  // 4. Verify notebook still exists and ownership
  const notebookSnap = await db().doc(`notebooks/${notebookId}`).get();
  if (!notebookSnap.exists || notebookSnap.data()?.ownerId !== link.firebaseUid) {
    await sendMessage(chatId, "This notebook no longer exists. Use /notebooks to pick another.");
    // Clear the active notebook
    await db().doc(`telegramLinks/${chatId}`).update({
      activeNotebookId: null,
      activeSessionId: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const state = chatStates.get(chatId);
    if (state) {
      state.notebookId = null;
      state.sessionId = null;
    }
    return;
  }

  const notebookData = notebookSnap.data()!;
  const customSystemPrompt = (notebookData.systemPrompt as string) || undefined;
  const notebookTools = (notebookData.tools as Record<string, boolean>) || {};

  // 5. Session management (get or create, check expiry)
  const { sessionId, history } = await getOrCreateSession(chatId, link, notebookId);
  const modelId = link.activeModelId || TELEGRAM_DEFAULT_MODEL;

  // Parse slash commands (/web, /maps, /url)
  const { query: actualQuery, toolOverride } = parseSlashCommand(text);

  // Show typing indicator
  await sendChatAction(chatId);

  try {
    // 6. Query with selected tool
    const stream = queryWithFileSearch(
      actualQuery,
      history,
      notebookId,
      modelId,
      customSystemPrompt,
      "telegram",
      notebookTools,
      toolOverride
    );

    // 7. Stream response to Telegram
    const { fullText, totalTokens } = await streamResponse(chatId, stream);

    if (!fullText) {
      await sendMessage(chatId, "I couldn't generate a response. Please try rephrasing your question.");
      return;
    }

    // 8. Save messages to Firestore
    const messagesRef = db().collection(`notebooks/${notebookId}/sessions/${sessionId}/messages`);

    await messagesRef.add({
      sessionId,
      role: "user",
      content: text,
      citations: null,
      tokenCount: 0,
      modelId,
      agentType: toolOverride ?? "user",
      metrics: null,
      superseded: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await messagesRef.add({
      sessionId,
      role: "assistant",
      content: fullText,
      citations: null,
      tokenCount: totalTokens,
      modelId,
      agentType: toolOverride ?? "filesearch",
      metrics: null,
      superseded: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 9. Update session token count and message count
    const sessionRef = db().doc(`notebooks/${notebookId}/sessions/${sessionId}`);
    await sessionRef.update({
      totalTokens: admin.firestore.FieldValue.increment(totalTokens),
      messageCount: admin.firestore.FieldValue.increment(2),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 10. Check summarization threshold
    await checkAndSummarize(notebookId, sessionId);
  } catch (err) {
    console.error("[TELEGRAM] Chat error:", err);
    await sendMessage(chatId, "Something went wrong. Please try again.");
  }
}

async function getOrCreateSession(
  chatId: number,
  link: TelegramLink,
  notebookId: string
): Promise<{ sessionId: string; history: Array<{ role: string; content: string }> }> {
  let sessionId = link.activeSessionId;
  let history: Array<{ role: string; content: string }> = [];

  // Check if existing session is still valid
  if (sessionId) {
    const sessionDoc = await db()
      .doc(`notebooks/${notebookId}/sessions/${sessionId}`)
      .get();

    if (sessionDoc.exists) {
      const sessionData = sessionDoc.data()!;
      const updatedAt = sessionData.updatedAt?.toMillis?.() ?? sessionData.createdAt?.toMillis?.() ?? 0;

      if (Date.now() - updatedAt > TELEGRAM_SESSION_TTL_MS) {
        // Session expired — archive it
        await sessionDoc.ref.update({
          status: "archived",
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        sessionId = null;
      } else {
        // Session still active — load recent messages for history
        history = await loadRecentHistory(notebookId, sessionId);
      }
    } else {
      sessionId = null;
    }
  }

  // Create new session if needed
  if (!sessionId) {
    const newSessionRef = await db()
      .collection(`notebooks/${notebookId}/sessions`)
      .add({
        notebookId,
        status: "active",
        totalTokens: 0,
        messageCount: 0,
        modelId: link.activeModelId || TELEGRAM_DEFAULT_MODEL,
        channel: "telegram",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    sessionId = newSessionRef.id;

    // Update link with new session
    await db().doc(`telegramLinks/${chatId}`).update({
      activeSessionId: sessionId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update in-memory state
    const state = chatStates.get(chatId);
    if (state) state.sessionId = sessionId;

    history = [];
  }

  return { sessionId, history };
}

async function loadRecentHistory(
  notebookId: string,
  sessionId: string
): Promise<Array<{ role: string; content: string }>> {
  const messagesSnap = await db()
    .collection(`notebooks/${notebookId}/sessions/${sessionId}/messages`)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  const messages = messagesSnap.docs
    .map((d) => d.data())
    .filter((m) => (m.role === "user" || m.role === "assistant") && !m.superseded)
    .map((m) => ({ role: m.role as string, content: m.content as string }))
    .reverse();

  return messages;
}

async function checkAndSummarize(notebookId: string, sessionId: string): Promise<void> {
  try {
    const sessionRef = db().doc(`notebooks/${notebookId}/sessions/${sessionId}`);
    const sessionSnap = await sessionRef.get();
    const sessionData = sessionSnap.data();

    if (!sessionData || sessionData.totalTokens < SUMMARIZATION_THRESHOLD) return;

    const lastFailed = sessionData.lastSummarizationFailedAt?.toMillis?.() ?? 0;
    if (Date.now() - lastFailed <= SUMMARIZATION_COOLDOWN_MS) return;

    // Load all messages for summarization
    const messagesSnap = await db()
      .collection(`notebooks/${notebookId}/sessions/${sessionId}/messages`)
      .orderBy("createdAt", "asc")
      .get();

    const allMessages = messagesSnap.docs
      .map((d) => d.data())
      .filter((m) => (m.role === "user" || m.role === "assistant") && !m.superseded)
      .map((m) => ({ role: m.role as string, content: m.content as string }));

    const { summary, tokenCount: sumTokens } = await summarizeSession(allMessages);

    // Mark previous summaries as superseded
    const prevSummaries = messagesSnap.docs.filter(
      (d) => d.data().role === "summary" && !d.data().superseded
    );
    const batch = db().batch();
    for (const s of prevSummaries) {
      batch.update(s.ref, { superseded: true });
    }

    // Write new summary
    batch.set(
      db()
        .collection(`notebooks/${notebookId}/sessions/${sessionId}/messages`)
        .doc(),
      {
        sessionId,
        role: "summary",
        content: summary,
        citations: null,
        tokenCount: sumTokens,
        modelId: "gemini-2.5-flash",
        agentType: "summarizer",
        metrics: null,
        superseded: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }
    );

    // Update session token count
    batch.update(sessionRef, {
      totalTokens: admin.firestore.FieldValue.increment(sumTokens),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();
    console.log(`[TELEGRAM] Session ${sessionId} summarized (${sumTokens} tokens)`);
  } catch (err) {
    console.error("[TELEGRAM] Summarization failed:", err);
    await db()
      .doc(`notebooks/${notebookId}/sessions/${sessionId}`)
      .update({
        lastSummarizationFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      .catch(() => {});
  }
}
