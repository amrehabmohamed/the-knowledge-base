import type { OAuth2Client } from "google-auth-library";
import type { FunctionDeclaration } from "@google/genai";
import type { firestore } from "firebase-admin";

export type ToolClass = "read" | "write";

export interface ConnectorContext {
  uid: string;
  oauth: OAuth2Client;
  provider: string;
  sessionId?: string;
  idempotencyKey?: string;
}

export interface ConnectorTool {
  name: string;
  class: ToolClass;
  declaration: FunctionDeclaration;
  handler: (args: any, ctx: ConnectorContext) => Promise<unknown>;
  requiredScopes: string[];
  summarizeForApproval?: (args: any) => string;
}

export interface ConnectorProvider {
  id: string;
  displayName: string;
  initialScopes: string[];
  fullScopes: string[];
  tools: ConnectorTool[];
  buildAuthClient: (uid: string) => Promise<OAuth2Client>;
  exchangeCode: (code: string, redirectUri: string) => Promise<{ tokens: any; email: string }>;
  buildAuthUrl: (state: string, scopes: string[], redirectUri: string) => string;
  revoke: (refreshToken: string) => Promise<void>;
}

export interface EncryptedBlob { ciphertext: string; iv: string; dekId: string; }

export interface ConnectorRecord {
  provider: string;
  status: "connected" | "revoked" | "error";
  scopes: string[];
  refreshTokenCt?: EncryptedBlob;
  accessTokenCt?: EncryptedBlob;
  accessTokenExpiry?: number;
  googleAccountEmail?: string;
  connectedAt?: firestore.Timestamp;
  updatedAt?: firestore.Timestamp;
  lastError?: string;
}

export interface ConnectorStatus {
  provider: string;
  connected: boolean;
  email?: string;
  scopes?: string[];
  connectedAt?: string;
}

export interface PendingAction {
  uid: string;
  sessionId: string;
  provider: string;
  tool: string;
  args: any;
  idempotencyKey: string;
  status: "awaiting_approval" | "approved" | "executed" | "cancelled" | "expired" | "error";
  expiresAt: firestore.Timestamp;
  createdAt: firestore.Timestamp;
  result?: unknown;
  error?: string;
  summary: string;
}

export interface AuditLog {
  uid: string;
  sessionId?: string;
  provider: string;
  tool: string;
  args: any;
  result?: unknown;
  status: "ok" | "error" | "awaiting_approval" | "cancelled";
  idempotencyKey: string;
  latencyMs: number;
  model?: string;
  reasonCode?: string;
  createdAt: firestore.Timestamp;
  ttlAt: firestore.Timestamp;
}
