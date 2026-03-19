import { onRequest } from "firebase-functions/https";
import { onCall, HttpsError } from "firebase-functions/https";
import { onDocumentUpdated } from "firebase-functions/firestore";
import * as admin from "firebase-admin";
import { uploadToGeminiStore, deleteFromGeminiStore } from "./services/gemini";
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
  "notebooks/{notebookId}/sources/{sourceId}",
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

      // Upload to Gemini
      const geminiDocId = await uploadToGeminiStore(
        after.storageRef,
        after.fileType,
        after.displayName,
        { notebookId }
      );

      // Set status to ready
      await sourceRef.update({
        status: "ready",
        geminiDocId,
        failureReason: null,
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
