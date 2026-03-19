import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytesResumable,
  deleteObject,
} from "firebase/storage";
import { storage } from "@/lib/firebase";
import { getSourcesCollection, getSourceRef } from "@/lib/firestore";
import {
  SUPPORTED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_BATCH_SIZE,
} from "@/config/constants";
import { formatFileSize } from "@/lib/formatters";

export interface ValidationError {
  fileName: string;
  error: string;
}

function getFileExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export function validateFile(
  file: File,
  existingNames: string[]
): ValidationError | null {
  const ext = getFileExtension(file.name);

  if (!SUPPORTED_FILE_TYPES[ext]) {
    return {
      fileName: file.name,
      error: `Unsupported file type: .${ext}`,
    };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      fileName: file.name,
      error: `File exceeds 50 MB limit (${formatFileSize(file.size)})`,
    };
  }

  if (existingNames.includes(file.name)) {
    return {
      fileName: file.name,
      error: `A file named "${file.name}" already exists in this notebook`,
    };
  }

  return null;
}

export function validateBatch(
  files: FileList,
  existingNames: string[]
): { validFiles: File[]; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const validFiles: File[] = [];

  if (files.length > MAX_BATCH_SIZE) {
    errors.push({
      fileName: "Batch",
      error: `You can upload at most ${MAX_BATCH_SIZE} files at once. You selected ${files.length}.`,
    });
    return { validFiles, errors };
  }

  for (const file of Array.from(files)) {
    const error = validateFile(file, existingNames);
    if (error) {
      errors.push(error);
    } else {
      validFiles.push(file);
    }
  }

  // Sort valid files by size ascending (smaller files first per PRD)
  validFiles.sort((a, b) => a.size - b.size);

  return { validFiles, errors };
}

export interface UploadCallbacks {
  onProgress: (sourceId: string, progress: number) => void;
  onComplete: (sourceId: string) => void;
  onError: (sourceId: string, error: string) => void;
}

/**
 * Upload a single file: create Firestore doc, upload to Storage, set status to pending.
 */
export async function uploadFile(
  file: File,
  notebookId: string,
  userId: string,
  callbacks: UploadCallbacks
): Promise<string> {
  const ext = getFileExtension(file.name);
  const mimeType = SUPPORTED_FILE_TYPES[ext] || "application/octet-stream";

  // Pre-generate a source document ID
  const sourceDocRef = doc(getSourcesCollection(notebookId));
  const sourceId = sourceDocRef.id;

  const storagePath = `users/${userId}/notebooks/${notebookId}/sources/${sourceId}/${file.name}`;

  // Create source document with "uploading" status
  await setDoc(sourceDocRef, {
    notebookId,
    type: "file",
    displayName: file.name,
    originalUrl: null,
    storageRef: storagePath,
    geminiDocId: null,
    fileType: mimeType,
    sizeBytes: file.size,
    status: "uploading",
    failureReason: null,
    tags: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Upload to Cloud Storage with progress tracking
  const storageRef = ref(storage, storagePath);
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: mimeType,
  });

  return new Promise((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        callbacks.onProgress(sourceId, progress);
      },
      async (error) => {
        // Upload failed
        const message = error.message || "Upload failed";
        try {
          await updateDoc(getSourceRef(notebookId, sourceId), {
            status: "failed",
            failureReason: message,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Ignore Firestore update error
        }
        callbacks.onError(sourceId, message);
        reject(error);
      },
      async () => {
        // Upload complete — set status to "pending" to trigger Cloud Function
        try {
          await updateDoc(getSourceRef(notebookId, sourceId), {
            status: "pending",
            updatedAt: serverTimestamp(),
          });
          callbacks.onComplete(sourceId);
          resolve(sourceId);
        } catch (err) {
          callbacks.onError(sourceId, "Failed to update source status");
          reject(err);
        }
      }
    );
  });
}

/**
 * Upload a batch of files sequentially.
 */
export async function uploadBatch(
  files: File[],
  notebookId: string,
  userId: string,
  callbacks: UploadCallbacks
): Promise<void> {
  for (const file of files) {
    try {
      await uploadFile(file, notebookId, userId, callbacks);
    } catch {
      // Individual failures don't block the rest of the batch
      continue;
    }
  }
}

/**
 * Delete a source: remove from Storage and Firestore.
 */
export async function deleteSource(
  notebookId: string,
  sourceId: string,
  storageRef: string | null
): Promise<void> {
  // Delete from Cloud Storage if there's a file
  if (storageRef) {
    try {
      const fileRef = ref(storage, storageRef);
      await deleteObject(fileRef);
    } catch {
      // File may not exist (e.g. upload never completed)
    }
  }

  // Delete from Firestore
  await deleteDoc(getSourceRef(notebookId, sourceId));
}
