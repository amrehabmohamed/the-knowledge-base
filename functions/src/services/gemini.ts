import { GoogleGenAI } from "@google/genai";
import * as admin from "firebase-admin";
import { getGeminiApiKey } from "../config";

let genaiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!genaiClient) {
    genaiClient = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  }
  return genaiClient;
}

/**
 * Downloads a file from Cloud Storage, uploads it to a Gemini FileSearch store,
 * and returns the Gemini document/file ID.
 */
export async function uploadToGeminiStore(
  storageRef: string,
  mimeType: string,
  displayName: string,
  metadata: Record<string, string>
): Promise<string> {
  const client = getClient();

  // Download file from Cloud Storage to a temp buffer
  const bucket = admin.storage().bucket();
  const file = bucket.file(storageRef);
  const [buffer] = await file.download();

  // Upload to Gemini using the Files API
  const uint8 = new Uint8Array(buffer);
  const blob = new Blob([uint8], { type: mimeType });
  const uploadResult = await client.files.upload({
    file: blob,
    config: {
      displayName,
      mimeType,
    },
  });

  if (!uploadResult.name) {
    throw new Error("Gemini upload did not return a file name/ID");
  }

  return uploadResult.name;
}

/**
 * Deletes a document from the Gemini FileSearch store.
 */
export async function deleteFromGeminiStore(
  geminiDocId: string
): Promise<void> {
  const client = getClient();
  try {
    await client.files.delete({ name: geminiDocId });
  } catch (err: unknown) {
    // Log but don't throw — document may already be deleted
    console.warn(`Failed to delete Gemini doc ${geminiDocId}:`, err);
  }
}
