import * as admin from "firebase-admin";
import { GEMINI_MODELS, TELEGRAM_DEFAULT_MODEL } from "../config";
import { sendMessage } from "./telegramClient";
import type { ChatState, PendingLinking, TelegramLink } from "./types";

// In-memory state for multi-step flows and active chat sessions
const pendingLinkings = new Map<number, PendingLinking>();
export const chatStates = new Map<number, ChatState>();

function db() {
  return admin.firestore();
}

function generateOtpCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// --- /start ---

export async function handleStart(chatId: number): Promise<void> {
  // Check if already linked
  const linkDoc = await db().doc(`telegramLinks/${chatId}`).get();
  if (linkDoc.exists) {
    await sendMessage(chatId, "You're already linked! Use /notebooks to pick a notebook, or /help to see all commands.");
    return;
  }

  pendingLinkings.set(chatId, { step: "awaiting_email" });
  await sendMessage(chatId, "Welcome! Let's link your Knowledge Base account.\n\nWhat's your email address?");
}

// --- Handle email/code input during linking ---

export async function handleLinkingInput(chatId: number, text: string): Promise<boolean> {
  const pending = pendingLinkings.get(chatId);
  if (!pending) return false;

  if (pending.step === "awaiting_email") {
    await handleEmailInput(chatId, text.trim().toLowerCase());
    return true;
  }

  if (pending.step === "awaiting_code") {
    await handleCodeInput(chatId, text.trim());
    return true;
  }

  return false;
}

async function handleEmailInput(chatId: number, email: string): Promise<void> {
  // Basic email validation
  if (!email.includes("@") || !email.includes(".")) {
    await sendMessage(chatId, "That doesn't look like a valid email. Please try again:");
    return;
  }

  // Always show the same message regardless of whether email exists (security)
  await sendMessage(chatId, "If this email is registered, you'll receive a 4-digit code shortly. Check your spam folder.\n\nEnter the code:");

  // Update pending state to await code
  pendingLinkings.set(chatId, { step: "awaiting_code", email });

  try {
    // Check if user exists in Firebase Auth
    const userRecord = await admin.auth().getUserByEmail(email);

    // Generate OTP and store in Firestore
    const code = generateOtpCode();
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 5 * 60 * 1000);

    await db().collection("telegramOtpCodes").add({
      code,
      email,
      telegramChatId: chatId,
      firebaseUid: userRecord.uid,
      createdAt: now,
      expiresAt,
    });

    // Send email via Firebase Trigger Email extension
    await db().collection("mail").add({
      to: email,
      message: {
        subject: "Your Knowledge Base verification code",
        text: `Your verification code is: ${code}\n\nThis code expires in 5 minutes.\n\nIf you didn't request this, you can ignore this email.`,
      },
    });

    console.log(`[TELEGRAM] OTP sent to ${email} for chat ${chatId}`);
  } catch (err) {
    // User not found or email send failed — silently ignore (don't reveal if email exists)
    console.log(`[TELEGRAM] Email lookup/send for ${email}: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

async function handleCodeInput(chatId: number, code: string): Promise<void> {
  const pending = pendingLinkings.get(chatId);
  if (!pending?.email) {
    pendingLinkings.delete(chatId);
    await sendMessage(chatId, "Something went wrong. Please send /start to try again.");
    return;
  }

  // Look up OTP code
  const now = admin.firestore.Timestamp.now();
  const otpSnap = await db()
    .collection("telegramOtpCodes")
    .where("telegramChatId", "==", chatId)
    .where("code", "==", code)
    .where("email", "==", pending.email)
    .limit(1)
    .get();

  if (otpSnap.empty) {
    pendingLinkings.delete(chatId);
    await sendMessage(chatId, "Invalid or expired code. Send /start to try again.");
    return;
  }

  const otpDoc = otpSnap.docs[0];
  const otpData = otpDoc.data();

  // Check expiry
  if (otpData.expiresAt.toMillis() < now.toMillis()) {
    await otpDoc.ref.delete();
    pendingLinkings.delete(chatId);
    await sendMessage(chatId, "Code expired. Send /start to try again.");
    return;
  }

  // Link the account
  await db().doc(`telegramLinks/${chatId}`).set({
    telegramChatId: chatId,
    firebaseUid: otpData.firebaseUid,
    activeNotebookId: null,
    activeSessionId: null,
    activeModelId: TELEGRAM_DEFAULT_MODEL,
    linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Clean up OTP doc and pending state
  await otpDoc.ref.delete();
  pendingLinkings.delete(chatId);

  // Initialize in-memory state
  chatStates.set(chatId, {
    notebookId: null,
    sessionId: null,
    modelId: TELEGRAM_DEFAULT_MODEL,
  });

  await sendMessage(chatId, "Account linked! Use /notebooks to pick a notebook.");
}

// --- /unlink ---

export async function handleUnlink(chatId: number): Promise<void> {
  const linkDoc = await db().doc(`telegramLinks/${chatId}`).get();
  if (!linkDoc.exists) {
    await sendMessage(chatId, "Not linked to any account. Send /start to link.");
    return;
  }

  await db().doc(`telegramLinks/${chatId}`).delete();
  chatStates.delete(chatId);
  pendingLinkings.delete(chatId);

  await sendMessage(chatId, "Account unlinked. Send /start to link again.");
}

// --- /notebooks ---

export async function handleNotebooks(chatId: number, link: TelegramLink): Promise<void> {
  const notebooksSnap = await db()
    .collection("notebooks")
    .where("ownerId", "==", link.firebaseUid)
    .orderBy("updatedAt", "desc")
    .get();

  if (notebooksSnap.empty) {
    await sendMessage(chatId, "You don't have any notebooks yet. Create one in the web app first.");
    return;
  }

  const lines = notebooksSnap.docs.map((doc, i) => {
    const data = doc.data();
    const desc = data.description ? ` — ${data.description}` : "";
    return `${i + 1}. ${data.name}${desc}`;
  });

  const activeId = link.activeNotebookId;
  let activeLabel = "";
  if (activeId) {
    const idx = notebooksSnap.docs.findIndex((d) => d.id === activeId);
    if (idx >= 0) activeLabel = `\n\nCurrently active: #${idx + 1}`;
  }

  await sendMessage(chatId, `Your notebooks:\n\n${lines.join("\n")}${activeLabel}\n\nUse /switch <number> to select one.`);
}

// --- /switch ---

export async function handleSwitch(chatId: number, link: TelegramLink, args: string): Promise<void> {
  const num = parseInt(args, 10);
  if (isNaN(num) || num < 1) {
    await sendMessage(chatId, "Usage: /switch <number>\n\nUse /notebooks to see the list first.");
    return;
  }

  const notebooksSnap = await db()
    .collection("notebooks")
    .where("ownerId", "==", link.firebaseUid)
    .orderBy("updatedAt", "desc")
    .get();

  if (num > notebooksSnap.docs.length) {
    await sendMessage(chatId, `Invalid number. You have ${notebooksSnap.docs.length} notebook(s). Use /notebooks to see the list.`);
    return;
  }

  const selectedDoc = notebooksSnap.docs[num - 1];
  const selectedName = selectedDoc.data().name;

  // Update Firestore link
  await db().doc(`telegramLinks/${chatId}`).update({
    activeNotebookId: selectedDoc.id,
    activeSessionId: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update in-memory state
  const state = chatStates.get(chatId) ?? {
    notebookId: null,
    sessionId: null,
    modelId: link.activeModelId || TELEGRAM_DEFAULT_MODEL,
  };
  state.notebookId = selectedDoc.id;
  state.sessionId = null;
  chatStates.set(chatId, state);

  await sendMessage(chatId, `Switched to "${selectedName}". You can now send me questions!`);
}

// --- /model ---

export async function handleModel(chatId: number, link: TelegramLink, args: string): Promise<void> {
  const modelKeys = Object.keys(GEMINI_MODELS);
  const currentModel = link.activeModelId || TELEGRAM_DEFAULT_MODEL;

  if (!args) {
    // List models
    const lines = modelKeys.map((key, i) => {
      const marker = key === currentModel ? " ✓" : "";
      return `${i + 1}. ${key}${marker}`;
    });
    await sendMessage(chatId, `Available models:\n\n${lines.join("\n")}\n\nUse /model <number> to switch.`);
    return;
  }

  const num = parseInt(args, 10);
  if (isNaN(num) || num < 1 || num > modelKeys.length) {
    await sendMessage(chatId, `Invalid number. Choose 1-${modelKeys.length}. Use /model to see the list.`);
    return;
  }

  const selectedModel = modelKeys[num - 1];

  await db().doc(`telegramLinks/${chatId}`).update({
    activeModelId: selectedModel,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update in-memory state
  const state = chatStates.get(chatId);
  if (state) state.modelId = selectedModel;

  await sendMessage(chatId, `Model switched to ${selectedModel}.`);
}

// --- /status ---

export async function handleStatus(chatId: number, link: TelegramLink): Promise<void> {
  const parts: string[] = [];

  // Notebook
  if (link.activeNotebookId) {
    const nbDoc = await db().doc(`notebooks/${link.activeNotebookId}`).get();
    const nbName = nbDoc.exists ? nbDoc.data()?.name : "(deleted)";
    parts.push(`Notebook: ${nbName}`);
  } else {
    parts.push("Notebook: none selected");
  }

  // Model
  parts.push(`Model: ${link.activeModelId || TELEGRAM_DEFAULT_MODEL}`);

  // Session
  if (link.activeSessionId && link.activeNotebookId) {
    const sessionDoc = await db()
      .doc(`notebooks/${link.activeNotebookId}/sessions/${link.activeSessionId}`)
      .get();
    if (sessionDoc.exists) {
      const data = sessionDoc.data()!;
      const tokens = data.totalTokens ?? 0;
      const messages = data.messageCount ?? 0;
      parts.push(`Session: ${messages} messages, ${tokens.toLocaleString()} tokens`);
    } else {
      parts.push("Session: none");
    }
  } else {
    parts.push("Session: none");
  }

  await sendMessage(chatId, parts.join("\n"));
}

// --- /reset ---

export async function handleReset(chatId: number, link: TelegramLink): Promise<void> {
  if (!link.activeNotebookId || !link.activeSessionId) {
    await sendMessage(chatId, "No active session to reset.");
    return;
  }

  // Archive the current session
  await db()
    .doc(`notebooks/${link.activeNotebookId}/sessions/${link.activeSessionId}`)
    .update({
      status: "archived",
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  // Clear active session
  await db().doc(`telegramLinks/${chatId}`).update({
    activeSessionId: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const state = chatStates.get(chatId);
  if (state) state.sessionId = null;

  await sendMessage(chatId, "Session archived. Your next message will start a fresh conversation.");
}

// --- /help ---

export async function handleHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    [
      "Available commands:",
      "",
      "/notebooks — List your notebooks",
      "/switch <number> — Select a notebook",
      "/model — List available AI models",
      "/model <number> — Switch model",
      "/status — Show current notebook, model, and session info",
      "/reset — Archive session and start fresh",
      "/unlink — Disconnect this Telegram account",
      "/help — Show this message",
      "",
      "Or just type a question to chat with your active notebook!",
    ].join("\n")
  );
}

// --- Helper: get or load link + state ---

export async function getLink(chatId: number): Promise<TelegramLink | null> {
  const doc = await db().doc(`telegramLinks/${chatId}`).get();
  if (!doc.exists) return null;

  const link = doc.data() as TelegramLink;

  // Hydrate in-memory state if needed (e.g. after cold start)
  if (!chatStates.has(chatId)) {
    chatStates.set(chatId, {
      notebookId: link.activeNotebookId,
      sessionId: link.activeSessionId,
      modelId: link.activeModelId || TELEGRAM_DEFAULT_MODEL,
    });
  }

  return link;
}
