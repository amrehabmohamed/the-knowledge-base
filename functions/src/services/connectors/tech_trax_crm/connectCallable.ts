import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/https";
import { encrypt } from "../crypto";
import { verifyState } from "../stateJwt";

interface ConnectArgs {
  state?: string;
  baseUrl?: string;
  email?: string;
  password?: string;
}

function decodeJwtExpiryMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    if (typeof payload?.exp === "number") return payload.exp * 1000;
    return null;
  } catch {
    return null;
  }
}

function validateBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpsError("invalid-argument", "baseUrl is not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new HttpsError("invalid-argument", "baseUrl must use http(s)");
  }
  return u.toString().replace(/\/$/, "");
}

export const connectTechTraxCrm = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be authenticated.");
  }
  const uid = request.auth.uid;
  const { state, baseUrl, email, password } = (request.data ?? {}) as ConnectArgs;

  if (!state || typeof state !== "string") {
    throw new HttpsError("invalid-argument", "state is required");
  }
  if (!baseUrl || typeof baseUrl !== "string") {
    throw new HttpsError("invalid-argument", "baseUrl is required");
  }
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "email is required");
  }
  if (!password || typeof password !== "string") {
    throw new HttpsError("invalid-argument", "password is required");
  }

  // Verify state JWT — must match this user and target tech_trax_crm provider.
  let decoded: { uid: string; provider: string };
  try {
    decoded = verifyState(state);
  } catch {
    throw new HttpsError("permission-denied", "Invalid state token");
  }
  if (decoded.uid !== uid) {
    throw new HttpsError("permission-denied", "State does not match user");
  }
  if (decoded.provider !== "tech_trax_crm") {
    throw new HttpsError("permission-denied", "State does not match provider");
  }

  const cleanBaseUrl = validateBaseUrl(baseUrl);

  // Login against Tech Trax.
  let loginRes: Response;
  try {
    loginRes = await fetch(`${cleanBaseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ key: email, password }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return { ok: false, code: "network_error", message };
  }

  let loginJson: any;
  try {
    loginJson = await loginRes.json();
  } catch {
    loginJson = null;
  }

  if (!loginRes.ok || !loginJson) {
    return {
      ok: false,
      code: loginJson?.code ?? "login_failed",
      message: loginJson?.message ?? `Tech Trax login failed (${loginRes.status})`,
    };
  }

  // Tech Trax response shape: { status, data: { user, tokens: { accessToken, refreshToken } } }.
  // Be permissive: accept tokens at data.tokens.* (canonical), data.* (older
  // builds), or top-level (very old / unwrapped).
  const data = loginJson?.data ?? loginJson;
  const tokens = data?.tokens ?? data ?? {};
  const accessToken =
    tokens?.accessToken ?? tokens?.access_token ?? data?.accessToken ?? data?.access_token;
  const refreshToken =
    tokens?.refreshToken ?? tokens?.refresh_token ?? data?.refreshToken ?? data?.refresh_token;
  if (!accessToken || !refreshToken) {
    return {
      ok: false,
      code: "login_invalid_response",
      message: "Login response missing tokens",
    };
  }

  let accessTokenCt;
  let refreshTokenCt;
  let passwordCt;
  try {
    [accessTokenCt, refreshTokenCt, passwordCt] = await Promise.all([
      encrypt(accessToken),
      encrypt(refreshToken),
      encrypt(password),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "encryption error";
    return { ok: false, code: "encrypt_failed", message };
  }

  const accessTokenExpiry = decodeJwtExpiryMs(accessToken);
  const db = getFirestore();
  const ref = db.doc(`users/${uid}/connectors/tech_trax_crm`);
  const now = FieldValue.serverTimestamp();
  const existing = await ref.get();
  const docData: Record<string, unknown> = {
    provider: "tech_trax_crm",
    status: "connected",
    baseUrl: cleanBaseUrl,
    email,
    accessTokenCt,
    refreshTokenCt,
    passwordCt,
    accessTokenExpiry: accessTokenExpiry ?? null,
    scopes: [],
    updatedAt: now,
  };
  if (!existing.exists) docData.connectedAt = now;
  await ref.set(docData, { merge: true });

  return { ok: true, email };
});
