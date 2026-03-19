import { onRequest } from "firebase-functions/https";
import { onCall, HttpsError } from "firebase-functions/https";
import { onDocumentUpdated } from "firebase-functions/firestore";
import * as admin from "firebase-admin";
import {
  uploadToGeminiStore,
  deleteFromGeminiStore,
  queryWithFileSearch,
} from "./services/gemini";
import { extractUrl } from "./services/jina";
import { validateAuth } from "./middleware/auth";
import type { Source } from "./types";

admin.initializeApp();

// Health check endpoint
export const health = onRequest((_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Ping endpoint for warm-up
export const ping = onRequest((_req, res) => {
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Build metadata from notebookId + user tags
      const metadata: Record<string, string> = { notebookId };
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`Source ${sourceId} indexed successfully as ${geminiDocId}`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error during indexing";
      console.error(`Source ${sourceId} indexing failed:`, err);

      await sourceRef.update({
        status: "failed",
        failureReason: message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
  const storage = admin.storage().bucket();
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      // Fetch URL content via Jina
      const { title, markdown } = await extractUrl(url);

      // Save extracted markdown to Cloud Storage
      const storagePath = `users/${uid}/notebooks/${notebookId}/sources/${sourceId}/extracted.md`;
      const bucket = admin.storage().bucket();
      const file = bucket.file(storagePath);
      const buffer = Buffer.from(markdown, "utf-8");
      await file.save(buffer, { contentType: "text/markdown" });

      // Update source doc — status "pending" triggers Gemini indexing
      await sourceRef.update({
        displayName: title || url,
        storageRef: storagePath,
        sizeBytes: buffer.byteLength,
        status: "pending",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, sourceId };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to process URL.";
      await sourceRef.update({
        status: "failed",
        failureReason: message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
      await admin.storage().bucket().file(source.storageRef).delete();
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
  { cors: true, timeoutSeconds: 300 },
  async (req, res) => {
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

    const { notebookId, query, modelId, history } = req.body;

    if (!notebookId || !query) {
      res.status(400).json({ error: "Missing required fields." });
      return;
    }

    // Verify notebook ownership
    const db = admin.firestore();
    const notebookSnap = await db.doc(`notebooks/${notebookId}`).get();
    if (
      !notebookSnap.exists ||
      notebookSnap.data()?.ownerId !== decodedToken.uid
    ) {
      res.status(403).json({ error: "Access denied." });
      return;
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const startTime = Date.now();
    let firstTokenTime: number | null = null;
    let tokenCount = 0;

    try {
      const stream = queryWithFileSearch(
        query,
        history ?? [],
        notebookId,
        modelId ?? "gemini-3-flash"
      );

      for await (const chunk of stream) {
        if (chunk.type === "token") {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
          }
          tokenCount++;
          res.write(
            `event: token\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`
          );
        } else if (chunk.type === "citations") {
          res.write(
            `event: citations\ndata: ${JSON.stringify({ citations: chunk.citations })}\n\n`
          );
        } else if (chunk.type === "done") {
          const totalMs = Date.now() - startTime;
          const ttftMs = firstTokenTime
            ? firstTokenTime - startTime
            : totalMs;
          res.write(
            `event: metrics\ndata: ${JSON.stringify({ ttftMs, totalMs, tokenCount })}\n\n`
          );
          res.write(`event: done\ndata: {}\n\n`);
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
