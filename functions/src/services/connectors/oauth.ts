import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { getProvider } from "./index";
import { signState, verifyState } from "./stateJwt";
import { encrypt } from "./crypto";
import { getGoogleOAuthRedirectUri } from "../../config";

export type OAuthMode = "initial" | "expand";

export function buildOAuthStartUrl(
  uid: string,
  providerId: string,
  mode: OAuthMode
): string {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown connector provider: ${providerId}`);
  }
  const scopes =
    mode === "expand" ? provider.fullScopes : provider.initialScopes;
  const nonce = crypto.randomBytes(16).toString("hex");
  // mode is added as an extra field; verifyState will strip-validate the core fields.
  const state = signState(
    { uid, provider: providerId, nonce, mode } as unknown as {
      uid: string;
      provider: string;
      nonce: string;
    },
    600
  );
  const redirectUri = getGoogleOAuthRedirectUri();
  return provider.buildAuthUrl(state, scopes, redirectUri);
}

export async function handleOAuthCallback(
  code: string,
  state: string
): Promise<{ uid: string; provider: string; email: string }> {
  const decoded = verifyState(state) as {
    uid: string;
    provider: string;
    nonce: string;
    mode?: OAuthMode;
  };
  const provider = getProvider(decoded.provider);
  if (!provider) {
    throw new Error(`Unknown connector provider: ${decoded.provider}`);
  }
  const redirectUri = getGoogleOAuthRedirectUri();
  const { tokens, email } = await provider.exchangeCode(code, redirectUri);

  const refreshTokenCt = tokens.refresh_token
    ? await encrypt(String(tokens.refresh_token))
    : undefined;
  const accessTokenCt = tokens.access_token
    ? await encrypt(String(tokens.access_token))
    : undefined;

  const scopes: string[] =
    typeof tokens.scope === "string" && tokens.scope.length > 0
      ? tokens.scope.split(" ")
      : [];

  const db = admin.firestore();
  const ref = db.doc(
    `users/${decoded.uid}/connectors/${decoded.provider}`
  );

  const now = admin.firestore.FieldValue.serverTimestamp();
  const data: Record<string, unknown> = {
    provider: decoded.provider,
    status: "connected",
    scopes,
    googleAccountEmail: email,
    accessTokenExpiry: tokens.expiry_date ?? null,
    updatedAt: now,
  };
  if (refreshTokenCt) data.refreshTokenCt = refreshTokenCt;
  if (accessTokenCt) data.accessTokenCt = accessTokenCt;

  const existing = await ref.get();
  if (!existing.exists) {
    data.connectedAt = now;
  }

  await ref.set(data, { merge: true });

  return { uid: decoded.uid, provider: decoded.provider, email };
}
