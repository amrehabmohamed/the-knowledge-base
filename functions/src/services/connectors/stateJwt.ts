import jwt from "jsonwebtoken";

export interface StatePayload { uid: string; provider: string; nonce: string; }

export function getStateSecret(): string {
  const s = process.env.CONNECTOR_STATE_SIGNING_SECRET;
  if (!s) throw new Error("CONNECTOR_STATE_SIGNING_SECRET is not set");
  return s;
}

export function signState(payload: StatePayload, ttlSec = 600): string {
  return jwt.sign(payload, getStateSecret(), { algorithm: "HS256", expiresIn: ttlSec });
}

export function verifyState(token: string): StatePayload {
  const decoded = jwt.verify(token, getStateSecret(), { algorithms: ["HS256"] }) as any;
  if (!decoded || typeof decoded !== "object" || !decoded.uid || !decoded.provider || !decoded.nonce) {
    throw new Error("Invalid state payload");
  }
  return { uid: decoded.uid, provider: decoded.provider, nonce: decoded.nonce };
}
