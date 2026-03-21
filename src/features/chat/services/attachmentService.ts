import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import {
  CHAT_ATTACHMENT_TYPES,
  CHAT_ATTACHMENT_MAX_SIZE,
  MAX_CHAT_ATTACHMENTS,
} from "@/config/constants";
import { formatFileSize } from "@/lib/formatters";
import type { Attachment } from "@/types/session";

function getFileExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

export interface AttachmentValidationError {
  fileName: string;
  error: string;
}

/**
 * Validate a single file for chat attachment.
 */
export function validateAttachment(file: File): AttachmentValidationError | null {
  const ext = getFileExtension(file.name);

  if (!CHAT_ATTACHMENT_TYPES[ext]) {
    return {
      fileName: file.name,
      error: `Unsupported type: .${ext}. Supported: images, audio, PDF.`,
    };
  }

  if (file.size > CHAT_ATTACHMENT_MAX_SIZE) {
    return {
      fileName: file.name,
      error: `File exceeds 10 MB limit (${formatFileSize(file.size)})`,
    };
  }

  return null;
}

/**
 * Validate a batch of files for chat attachment.
 */
export function validateAttachments(
  files: File[]
): { valid: File[]; errors: AttachmentValidationError[] } {
  const errors: AttachmentValidationError[] = [];
  const valid: File[] = [];

  if (files.length > MAX_CHAT_ATTACHMENTS) {
    errors.push({
      fileName: "Batch",
      error: `You can attach at most ${MAX_CHAT_ATTACHMENTS} files per message.`,
    });
    return { valid, errors };
  }

  for (const file of files) {
    const error = validateAttachment(file);
    if (error) {
      errors.push(error);
    } else {
      valid.push(file);
    }
  }

  return { valid, errors };
}

/**
 * Get the attachment type category from MIME type.
 */
function getAttachmentType(mimeType: string): "image" | "audio" | "pdf" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "pdf";
}

/**
 * Upload a file to Cloud Storage for chat attachment and return metadata.
 */
export async function uploadChatAttachment(
  file: File,
  userId: string,
  notebookId: string,
  sessionId: string
): Promise<Attachment> {
  const ext = getFileExtension(file.name);
  const mimeType = CHAT_ATTACHMENT_TYPES[ext] || file.type;
  const uniqueName = `${crypto.randomUUID()}-${file.name}`;
  const storagePath = `users/${userId}/chat-attachments/${notebookId}/${sessionId}/${uniqueName}`;

  const storageRef = ref(storage, storagePath);
  const snapshot = await uploadBytesResumable(storageRef, file, {
    contentType: mimeType,
  });

  const downloadUrl = await getDownloadURL(snapshot.ref);

  return {
    type: getAttachmentType(mimeType),
    mimeType,
    fileName: file.name,
    sizeBytes: file.size,
    storageRef: storagePath,
    downloadUrl,
  };
}
