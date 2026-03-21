import type { Timestamp } from "firebase-admin/firestore";

// --- Telegram Bot API types ---

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  first_name?: string;
  username?: string;
}

export interface TelegramLocation {
  latitude: number;
  longitude: number;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
  file_name?: string;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  location?: TelegramLocation;
  photo?: TelegramPhotoSize[];
  audio?: TelegramAudio;
  voice?: TelegramVoice;
  document?: TelegramDocument;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// --- Firestore document types ---

export interface TelegramLink {
  telegramChatId: number;
  firebaseUid: string;
  activeNotebookId: string | null;
  activeSessionId: string | null;
  activeModelId: string;
  linkedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TelegramOtpCode {
  code: string;
  email: string;
  telegramChatId: number;
  firebaseUid: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

// --- In-memory state ---

export type LinkingStep = "awaiting_email" | "awaiting_code";

export interface PendingLinking {
  step: LinkingStep;
  email?: string;
}

export interface ChatState {
  notebookId: string | null;
  sessionId: string | null;
  modelId: string;
  pendingLinking?: PendingLinking;
}
