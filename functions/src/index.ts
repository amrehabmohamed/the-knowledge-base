import { onRequest } from "firebase-functions/https";
import { onCall, HttpsError } from "firebase-functions/https";
import { onDocumentUpdated } from "firebase-functions/firestore";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
  uploadToGeminiStore,
  deleteFromGeminiStore,
  routeChat,
} from "./services/gemini";
import { extractUrl } from "./services/jina";
import { summarizeSession } from "./services/summarize";
import { validateAuth } from "./middleware/auth";
import {
  SUMMARIZATION_THRESHOLD,
  SUMMARIZATION_COOLDOWN_MS,
  getStorageBucketName,
  CONNECTORS_ENABLED,
} from "./config";
import {
  buildOAuthStartUrl,
  handleOAuthCallback,
} from "./services/connectors/oauth";
import {
  getProvider,
  getAllProviders,
  executeApprovedAction,
  getPendingAction,
  markStatus,
  decrypt,
  writeAudit,
} from "./services/connectors";
import type {
  ConnectorRecord,
  ConnectorStatus,
} from "./services/connectors/types";
import { telegramWebhook } from "./telegram/webhook";
import type { Source } from "./types";

admin.initializeApp();

// Re-export Telegram webhook
export { telegramWebhook };

// Health check endpoint
export const health = onRequest({ cors: true }, (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Ping endpoint for warm-up
export const ping = onRequest({ cors: true }, (_req, res) => {
  res.json({ status: "warm" });
});

/**
 * Firestore trigger: when a source status changes to "pending",
 * upload the file to Gemini FileSearch and update status to "ready" or "failed".
 */
export const onSourceStatusChange = onDocumentUpdated(
  { document: "notebooks/{notebookId}/sources/{sourceId}", timeoutSeconds: 120 },
  async (event) => {
    if (!event.data) return;

    const before = event.data.before.data() as Source;
    const after = event.data.after.data() as Source;
    const { notebookId, sourceId } = event.params;

    // Only process when status changes to "pending"
    if (before.status === "pending" || after.status !== "pending") {
      return;
    }

    const sourceRef = event.data.after.ref;

    try {
      // Set status to indexing
      await sourceRef.update({
        status: "indexing",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Build metadata from notebook_id + user tags
      // IMPORTANT: Gemini metadataFilter does NOT support camelCase keys — use snake_case
      const metadata: Record<string, string> = { notebook_id: notebookId };
      const sourceTags = (after.tags as Array<{ key: string; value: string }>) ?? [];
      for (const tag of sourceTags) {
        if (tag.key && tag.value) {
          metadata[tag.key] = tag.value;
        }
      }

      // Upload to Gemini
      const geminiDocId = await uploadToGeminiStore(
        after.storageRef,
        after.fileType,
        after.displayName,
        metadata
      );

      // Set status to ready with processing time
      const startedAt = after.startedAt as number | undefined;
      const processingMs = startedAt ? Date.now() - startedAt : null;

      await sourceRef.update({
        status: "ready",
        geminiDocId,
        failureReason: null,
        processingMs,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`Source ${sourceId} indexed successfully as ${geminiDocId}`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error during indexing";
      console.error(`Source ${sourceId} indexing failed:`, err);

      await sourceRef.update({
        status: "failed",
        failureReason: message,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);

/**
 * Callable function: delete all sources (from Gemini + Storage + Firestore)
 * for a notebook, then delete the notebook itself.
 */
export const deleteNotebookData = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }

  const notebookId = request.data?.notebookId;
  if (!notebookId || typeof notebookId !== "string") {
    throw new HttpsError("invalid-argument", "notebookId is required.");
  }

  const db = admin.firestore();
  const storage = admin.storage().bucket(getStorageBucketName());
  const uid = request.auth.uid;

  // Verify notebook ownership
  const notebookRef = db.doc(`notebooks/${notebookId}`);
  const notebookSnap = await notebookRef.get();

  if (!notebookSnap.exists || notebookSnap.data()?.ownerId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Notebook not found or you don't have access."
    );
  }

  // Get all sources
  const sourcesSnap = await db
    .collection(`notebooks/${notebookId}/sources`)
    .get();

  // Delete Gemini docs and storage files in parallel
  const deletePromises = sourcesSnap.docs.map(async (sourceDoc) => {
    const source = sourceDoc.data() as Source;

    // Delete from Gemini if indexed
    if (source.geminiDocId) {
      await deleteFromGeminiStore(source.geminiDocId);
    }

    // Delete from Cloud Storage
    if (source.storageRef) {
      try {
        await storage.file(source.storageRef).delete();
      } catch {
        // File may already be deleted
      }
    }
  });

  await Promise.all(deletePromises);

  // Delete all source documents in a batch
  const batch = db.batch();
  sourcesSnap.docs.forEach((doc) => batch.delete(doc.ref));

  // Delete sessions and their messages subcollections
  const sessionsSnap = await db
    .collection(`notebooks/${notebookId}/sessions`)
    .get();

  for (const sessionDoc of sessionsSnap.docs) {
    const messagesSnap = await sessionDoc.ref.collection("messages").get();
    messagesSnap.docs.forEach((msgDoc) => batch.delete(msgDoc.ref));
    batch.delete(sessionDoc.ref);
  }

  // Delete the notebook document
  batch.delete(notebookRef);

  await batch.commit();

  return { success: true };
});

/**
 * Callable: ingest a URL via Jina Reader → Cloud Storage → Gemini indexing.
 */
export const ingestUrl = onCall(
  { timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be authenticated.");
    }

    const { notebookId, url } = request.data ?? {};
    if (!notebookId || !url) {
      throw new HttpsError(
        "invalid-argument",
        "notebookId and url are required."
      );
    }

    const db = admin.firestore();
    const uid = request.auth.uid;

    // Verify notebook ownership
    const notebookSnap = await db.doc(`notebooks/${notebookId}`).get();
    if (!notebookSnap.exists || notebookSnap.data()?.ownerId !== uid) {
      throw new HttpsError("permission-denied", "Notebook not found.");
    }

    // Check URL uniqueness
    const existingSnap = await db
      .collection(`notebooks/${notebookId}/sources`)
      .where("originalUrl", "==", url)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      throw new HttpsError(
        "already-exists",
        "This URL has already been added to this notebook."
      );
    }

    // Create source doc with "fetching" status
    const sourceRef = db.collection(`notebooks/${notebookId}/sources`).doc();
    const sourceId = sourceRef.id;

    await sourceRef.set({
      notebookId,
      type: "url",
      displayName: url,
      originalUrl: url,
      storageRef: "",
      geminiDocId: null,
      fileType: "text/markdown",
      sizeBytes: null,
      status: "fetching",
      failureReason: null,
      tags: [],
      startedAt: Date.now(),
      processingMs: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      // Fetch URL content via Jina
      const { title, markdown } = await extractUrl(url);

      // Save extracted markdown to Cloud Storage
      const storagePath = `users/${uid}/notebooks/${notebookId}/sources/${sourceId}/extracted.md`;
      const bucket = admin.storage().bucket(getStorageBucketName());
      const file = bucket.file(storagePath);
      const buffer = Buffer.from(markdown, "utf-8");
      await file.save(buffer, { contentType: "text/markdown" });

      // Update source doc — status "pending" triggers Gemini indexing
      await sourceRef.update({
        displayName: title || url,
        storageRef: storagePath,
        sizeBytes: buffer.byteLength,
        status: "pending",
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { success: true, sourceId };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to process URL.";
      await sourceRef.update({
        status: "failed",
        failureReason: message,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { success: false, error: message };
    }
  }
);

/**
 * Callable: delete a single source (Gemini + Storage + Firestore).
 */
export const deleteSource = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }

  const { notebookId, sourceId } = request.data ?? {};
  if (!notebookId || !sourceId) {
    throw new HttpsError(
      "invalid-argument",
      "notebookId and sourceId are required."
    );
  }

  const db = admin.firestore();
  const uid = request.auth.uid;

  // Verify notebook ownership
  const notebookSnap = await db.doc(`notebooks/${notebookId}`).get();
  if (!notebookSnap.exists || notebookSnap.data()?.ownerId !== uid) {
    throw new HttpsError("permission-denied", "Notebook not found.");
  }

  // Get source doc
  const sourceRef = db.doc(
    `notebooks/${notebookId}/sources/${sourceId}`
  );
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) {
    throw new HttpsError("not-found", "Source not found.");
  }

  const source = sourceSnap.data() as Source;

  // Only allow deletion when ready or failed
  if (source.status !== "ready" && source.status !== "failed") {
    throw new HttpsError(
      "failed-precondition",
      "Source cannot be deleted while processing."
    );
  }

  // Delete from Gemini first (abort if fails per PRD)
  if (source.geminiDocId) {
    await deleteFromGeminiStore(source.geminiDocId);
  }

  // Delete from Cloud Storage
  if (source.storageRef) {
    try {
      await admin.storage().bucket(getStorageBucketName()).file(source.storageRef).delete();
    } catch {
      // File may not exist
    }
  }

  // Delete Firestore doc
  await sourceRef.delete();

  return { success: true };
});

/**
 * HTTP endpoint: streaming chat with Gemini FileSearch grounding.
 * Uses SSE (Server-Sent Events) for real-time token streaming.
 */
export const chat = onRequest(
  { cors: true, timeoutSeconds: 300, memory: "512MiB" },
  async (req, res) => {
    // Warmup ping — skip auth and processing
    if (req.method === "GET" || req.body?.warmup === true) {
      res.json({ status: "warm" });
      return;
    }

    // Validate auth
    let decodedToken;
    try {
      decodedToken = await validateAuth(req);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { notebookId, query: rawQuery, modelId, history, sessionId, toolOverride, attachments } = req.body;
    const query = rawQuery ?? "";
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

    if (!notebookId || (!query && !hasAttachments)) {
      res.status(400).json({ error: "Missing required fields." });
      return;
    }

    // Verify notebook ownership
    const db = admin.firestore();
    const notebookSnap = await db.doc(`notebooks/${notebookId}`).get();
    const notebookData = notebookSnap.data();
    if (!notebookSnap.exists || notebookData?.ownerId !== decodedToken.uid) {
      res.status(403).json({ error: "Access denied." });
      return;
    }

    // Per-notebook custom system prompt (appended to default)
    const customSystemPrompt = (notebookData?.systemPrompt as string) || undefined;

    // Per-notebook tool toggles (Google Search, URL Context, Maps)
    const notebookTools = (notebookData?.tools as Record<string, boolean>) || {};

    // --- Summarization check ---
    let chatHistory = history ?? [];

    // Existing Gemini context cache for this session, if any. Reused only when
    // it hasn't expired (60s safety margin). Hash gating happens orchestrator-
    // side: if the cached prefix doesn't match the current prefix hash, the
    // orchestrator will overwrite the session's cache record on this turn.
    let existingCacheName: string | undefined;

    if (sessionId) {
      const sessionRef = db.doc(
        `notebooks/${notebookId}/sessions/${sessionId}`
      );
      const sessionSnap = await sessionRef.get();
      const sessionData = sessionSnap.data();

      const cache = sessionData?.geminiCache as
        | { name?: string; hash?: string; expiresAt?: number }
        | null
        | undefined;
      if (
        cache?.name &&
        typeof cache.expiresAt === "number" &&
        cache.expiresAt > Date.now() + 60_000
      ) {
        existingCacheName = cache.name;
      }

      if (
        sessionData &&
        sessionData.totalTokens >= SUMMARIZATION_THRESHOLD
      ) {
        const lastFailed = sessionData.lastSummarizationFailedAt?.toMillis?.() ?? 0;
        const cooldownExpired =
          Date.now() - lastFailed > SUMMARIZATION_COOLDOWN_MS;

        if (cooldownExpired) {
          try {
            // Read messages from Firestore for reliable summarization
            const messagesSnap = await db
              .collection(
                `notebooks/${notebookId}/sessions/${sessionId}/messages`
              )
              .orderBy("createdAt", "asc")
              .get();

            const allMessages = messagesSnap.docs
              .map((d) => d.data())
              .filter(
                (m) =>
                  (m.role === "user" || m.role === "assistant") &&
                  !m.superseded
              )
              .map((m) => ({ role: m.role as string, content: m.content as string }));

            const { summary, tokenCount: sumTokens } =
              await summarizeSession(allMessages);

            // Mark previous summaries as superseded
            const prevSummaries = messagesSnap.docs.filter(
              (d) => d.data().role === "summary" && !d.data().superseded
            );
            const batch = db.batch();
            for (const s of prevSummaries) {
              batch.update(s.ref, { superseded: true });
            }

            // Write new summary message
            batch.set(
              db
                .collection(
                  `notebooks/${notebookId}/sessions/${sessionId}/messages`
                )
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
                createdAt: FieldValue.serverTimestamp(),
              }
            );

            // Update session token count
            batch.update(sessionRef, {
              totalTokens: FieldValue.increment(sumTokens),
              updatedAt: FieldValue.serverTimestamp(),
            });

            await batch.commit();

            // Replace history with summary for the query
            chatHistory = [{ role: "assistant", content: summary }];

            console.log(
              `[SUMMARIZE] Session ${sessionId} summarized (${sumTokens} tokens)`
            );
          } catch (err) {
            console.error("[SUMMARIZE] Failed:", err);
            await sessionRef.update({
              lastSummarizationFailedAt:
                FieldValue.serverTimestamp(),
            });
            // Continue with original history
          }
        }
      }
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const startTime = Date.now();
    let firstTokenTime: number | null = null;

    try {
      const stream = routeChat(
        query ?? "",
        chatHistory,
        decodedToken.uid,
        notebookId,
        sessionId,
        modelId ?? "gemini-3-flash",
        customSystemPrompt,
        "web",
        notebookTools,
        toolOverride,
        attachments,
        existingCacheName
      );

      for await (const chunk of stream) {
        if (chunk.type === "token") {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
          }
          res.write(
            `event: token\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`
          );
        } else if (chunk.type === "citations") {
          res.write(
            `event: citations\ndata: ${JSON.stringify({ citations: chunk.citations })}\n\n`
          );
        } else if (chunk.type === "tool_call") {
          res.write(
            `event: tool_call\ndata: ${JSON.stringify(chunk.toolCall)}\n\n`
          );
        } else if (chunk.type === "action_approval_required") {
          res.write(
            `event: action_approval_required\ndata: ${JSON.stringify(chunk.action)}\n\n`
          );
        } else if (chunk.type === "scope_expansion_required") {
          res.write(
            `event: scope_expansion_required\ndata: ${JSON.stringify(chunk.scope)}\n\n`
          );
        } else if (chunk.type === "clarification_required") {
          res.write(
            `event: clarification_required\ndata: ${JSON.stringify(chunk.clarification)}\n\n`
          );
        } else if (chunk.type === "cache_event") {
          // Server-side state only — no SSE event. Persist on the session doc
          // so the next turn can reuse the cache name + hash.
          if (sessionId) {
            db.doc(`notebooks/${notebookId}/sessions/${sessionId}`)
              .update({
                geminiCache: chunk.cache,
                updatedAt: FieldValue.serverTimestamp(),
              })
              .catch((err: unknown) =>
                console.error("[CHAT] Failed to persist geminiCache:", err)
              );
          }
        } else if (chunk.type === "done") {
          const totalMs = Date.now() - startTime;
          const ttftMs = firstTokenTime
            ? firstTokenTime - startTime
            : totalMs;
          const tokenCount = chunk.totalTokens;
          res.write(
            `event: metrics\ndata: ${JSON.stringify({ ttftMs, totalMs, tokenCount })}\n\n`
          );
          res.write(`event: done\ndata: {}\n\n`);

          // Update session totalTokens server-side with real Gemini token count
          if (sessionId && tokenCount > 0) {
            db.doc(`notebooks/${notebookId}/sessions/${sessionId}`)
              .update({
                totalTokens: FieldValue.increment(tokenCount),
                updatedAt: FieldValue.serverTimestamp(),
              })
              .catch((err: unknown) =>
                console.error("[CHAT] Failed to update totalTokens:", err)
              );
          }
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Chat request failed.";
      console.error("Chat stream error:", err);
      res.write(
        `event: error\ndata: ${JSON.stringify({ message })}\n\n`
      );
    }

    res.end();
  }
);

// --- Connector OAuth (HTTP, not callable; OAuth requires raw HTTP redirects) ---

function renderCallbackHtml(
  payload: Record<string, unknown>,
  fallbackMessage: string
): string {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connector</title>
<style>body{font-family:system-ui,sans-serif;padding:32px;color:#222}</style>
</head><body>
<p>${fallbackMessage}</p>
<script>
  (function(){
    var msg = ${json};
    try {
      // TODO: restrict targetOrigin to a trusted frontend origin once configured.
      if (window.opener) { window.opener.postMessage(msg, "*"); }
    } catch (e) {}
    try { window.close(); } catch (e) {}
  })();
</script>
</body></html>`;
}

export const connectorOAuthStart = onRequest(
  { cors: true },
  async (req, res) => {
    if (!CONNECTORS_ENABLED) {
      res.status(400).json({ error: "Connectors are disabled." });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await validateAuth(req);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const providerId =
      (req.query.provider as string | undefined) || "google_calendar";
    const modeRaw = (req.query.mode as string | undefined) || "initial";
    const mode: "initial" | "expand" =
      modeRaw === "expand" ? "expand" : "initial";

    if (!getProvider(providerId)) {
      res.status(404).json({ error: `Unknown provider: ${providerId}` });
      return;
    }

    try {
      const url = buildOAuthStartUrl(decodedToken.uid, providerId, mode);
      res.json({ url });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to build OAuth URL.";
      console.error("[connectorOAuthStart] error:", err);
      res.status(500).json({ error: message });
    }
  }
);

export const connectorOAuthCallback = onRequest(
  { cors: true, invoker: "public" },
  async (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    const error = req.query.error as string | undefined;
    if (error) {
      res
        .status(400)
        .send(
          renderCallbackHtml(
            { type: "connector:error", error },
            "Connection cancelled. You can close this window."
          )
        );
      return;
    }

    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code || !state) {
      res
        .status(400)
        .send(
          renderCallbackHtml(
            { type: "connector:error", error: "missing_code_or_state" },
            "Missing authorization code. You can close this window."
          )
        );
      return;
    }

    try {
      const result = await handleOAuthCallback(code, state);
      res.status(200).send(
        renderCallbackHtml(
          {
            type: "connector:connected",
            provider: result.provider,
            email: result.email,
          },
          "Connected. You can close this window."
        )
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "OAuth callback failed.";
      console.error("[connectorOAuthCallback] error:", err);
      res.status(500).send(
        renderCallbackHtml(
          { type: "connector:error", error: message },
          "Connection failed. You can close this window."
        )
      );
    }
  }
);

export const getConnectorStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }
  const uid = request.auth.uid;
  const db = admin.firestore();
  const providers = getAllProviders();

  const connectors: ConnectorStatus[] = await Promise.all(
    providers.map(async (provider) => {
      const snap = await db
        .doc(`users/${uid}/connectors/${provider.id}`)
        .get();
      if (!snap.exists) return { provider: provider.id, connected: false };
      const rec = snap.data() as ConnectorRecord;
      if (rec.status !== "connected") {
        return { provider: provider.id, connected: false };
      }
      return {
        provider: provider.id,
        connected: true,
        email: rec.googleAccountEmail ?? (rec as { email?: string }).email,
        scopes: rec.scopes,
        connectedAt: rec.connectedAt?.toDate().toISOString(),
      };
    })
  );

  return { connectors };
});

export const disconnectConnector = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }
  const providerId = request.data?.provider;
  if (!providerId || typeof providerId !== "string") {
    throw new HttpsError("invalid-argument", "provider is required.");
  }
  const provider = getProvider(providerId);
  if (!provider) {
    throw new HttpsError("not-found", `Unknown provider: ${providerId}`);
  }

  const uid = request.auth.uid;
  const db = admin.firestore();
  const ref = db.doc(`users/${uid}/connectors/${providerId}`);
  const snap = await ref.get();

  if (snap.exists) {
    const rec = snap.data() as ConnectorRecord;
    if (rec.refreshTokenCt) {
      try {
        const refreshToken = await decrypt(rec.refreshTokenCt);
        await provider.revoke(refreshToken);
      } catch (err: unknown) {
        // Best-effort; revoke can 400 if token already invalid.
        console.warn(
          `[disconnectConnector] revoke failed for ${providerId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    await ref.update({
      status: "revoked",
      refreshTokenCt: FieldValue.delete(),
      accessTokenCt: FieldValue.delete(),
      accessTokenExpiry: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return { ok: true };
});

export { connectTechTraxCrm } from "./services/connectors/tech_trax_crm/connectCallable";
export { techTraxCredentialsForm } from "./services/connectors/tech_trax_crm/credentialsForm";

export const confirmPendingAction = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }
  const actionId = request.data?.actionId;
  if (!actionId || typeof actionId !== "string") {
    throw new HttpsError("invalid-argument", "actionId is required.");
  }

  const uid = request.auth.uid;
  const pending = await getPendingAction(actionId);
  if (!pending) {
    throw new HttpsError("not-found", "Action not found");
  }
  if (pending.uid !== uid) {
    throw new HttpsError("permission-denied", "Action does not belong to user");
  }
  if (pending.status !== "awaiting_approval") {
    throw new HttpsError(
      "failed-precondition",
      `Action status is '${pending.status}'`
    );
  }
  if (pending.expiresAt.toMillis() < Date.now()) {
    await markStatus(actionId, "expired");
    throw new HttpsError("deadline-exceeded", "Action expired");
  }

  // executeApprovedAction transitions awaiting_approval -> executed (or error) atomically.
  // No intermediate 'approved' state.
  try {
    const result = await executeApprovedAction(actionId, uid);
    return { ok: true, result };
  } catch (err: unknown) {
    // Registry throws a normalized {code, message, retryable} object on handler
    // failure — not an Error instance. Pull `.message` from object form too,
    // otherwise the user sees a generic "Action execution failed." with no signal.
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message?: unknown }).message)
          : "Action execution failed.";
    console.error(
      `[CONFIRM] action=${actionId} tool=${pending.tool} failed:`,
      message,
      err
    );
    return { ok: false, error: message };
  }
});

export const cancelPendingAction = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }
  const actionId = request.data?.actionId;
  if (!actionId || typeof actionId !== "string") {
    throw new HttpsError("invalid-argument", "actionId is required.");
  }

  const uid = request.auth.uid;
  const pending = await getPendingAction(actionId);
  if (!pending) {
    throw new HttpsError("not-found", "Action not found");
  }
  if (pending.uid !== uid) {
    throw new HttpsError("permission-denied", "Action does not belong to user");
  }
  if (pending.status !== "awaiting_approval") {
    throw new HttpsError(
      "failed-precondition",
      `Action status is '${pending.status}'`
    );
  }

  await markStatus(actionId, "cancelled");
  await writeAudit({
    uid,
    sessionId: pending.sessionId,
    provider: pending.provider,
    tool: pending.tool,
    args: pending.args,
    status: "cancelled",
    idempotencyKey: pending.idempotencyKey,
    latencyMs: 0,
  });

  return { ok: true };
});

/**
 * Read-only status fetch for a pending action. Used by the frontend card on
 * mount when its runtime store is empty (e.g. after a page refresh) so it
 * can render the correct resolution (executed / cancelled / error / expired)
 * instead of falsely showing a still-clickable Confirm button.
 */
export const getPendingActionStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }
  const actionId = request.data?.actionId;
  if (!actionId || typeof actionId !== "string") {
    throw new HttpsError("invalid-argument", "actionId is required.");
  }
  const uid = request.auth.uid;
  const pending = await getPendingAction(actionId);
  if (!pending) {
    // Doc was never written or was already TTL-cleaned. Treat as expired so
    // the card collapses without the card-mount path retrying.
    return { status: "expired" as const };
  }
  if (pending.uid !== uid) {
    throw new HttpsError("permission-denied", "Action does not belong to user");
  }
  // If still nominally awaiting_approval but past its expiry, surface as
  // expired without rewriting (we don't want a read endpoint mutating state).
  const expired =
    pending.status === "awaiting_approval" &&
    pending.expiresAt.toMillis() < Date.now();
  return {
    status: expired ? ("expired" as const) : pending.status,
    result: pending.result ?? null,
    error: pending.error ?? null,
    expiresAt: pending.expiresAt.toMillis(),
  };
});
