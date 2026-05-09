import type { OAuth2Client } from "google-auth-library";
import type { FunctionDeclaration } from "@google/genai";
import type { firestore } from "firebase-admin";

export type ToolClass = "read" | "write";

export interface ConnectorContext {
  uid: string;
  /** Populated for OAuth providers (e.g. Google Calendar). Undefined for non-OAuth providers. */
  oauth?: OAuth2Client;
  provider: string;
  sessionId?: string;
  idempotencyKey?: string;
  /** Non-OAuth providers (e.g. Tech Trax) carry their HTTP client here. */
  client?: unknown;
  /** Opaque token for optimistic-lock headers (e.g. an HTTP-date or ETag). */
  lockToken?: string;
}

/**
 * Thrown by a connector tool handler when the call cannot proceed because the
 * agent supplied insufficient/invalid args (missing required fields the model
 * should ask the user about). The registry catches this and converts it to a
 * `validation_pending` dispatch result without creating a pending action.
 */
export class ValidationPendingError extends Error {
  public missing: Array<{ key: string; label: string; type: string }>;
  constructor(
    missing: Array<{ key: string; label: string; type: string }>,
    message: string
  ) {
    super(message);
    this.name = "ValidationPendingError";
    this.missing = missing;
  }
}

export interface ConnectorTool {
  name: string;
  class: ToolClass;
  declaration: FunctionDeclaration;
  handler: (args: any, ctx: ConnectorContext) => Promise<unknown>;
  requiredScopes: string[];
  summarizeForApproval?: (args: any) => string;
  /**
   * Optional pre-approval validation hook. Runs BEFORE the read/write branch in
   * dispatch. Throw `ValidationPendingError` to short-circuit and ask the user
   * for missing fields without creating a pending-action approval card.
   */
  preflight?: (args: any, ctx: ConnectorContext) => Promise<void>;
}

export interface ConnectorProvider {
  id: string;
  displayName: string;
  initialScopes: string[];
  fullScopes: string[];
  tools: ConnectorTool[];
  /** OAuth providers implement this; populates ctx.oauth. */
  buildAuthClient?: (uid: string) => Promise<OAuth2Client>;
  /**
   * Non-OAuth providers (e.g. Tech Trax JWT) implement this instead; populates
   * ctx.client. Exactly one of buildAuthClient or buildClient must be defined.
   */
  buildClient?: (uid: string) => Promise<unknown>;
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
  /**
   * Optimistic-lock token captured at preflight time (e.g. the lead's
   * `Last-Modified` HTTP-date). Persisted so executeApprovedAction can send
   * it as `If-Unmodified-Since` when the user confirms the write.
   */
  lockToken?: string;
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
