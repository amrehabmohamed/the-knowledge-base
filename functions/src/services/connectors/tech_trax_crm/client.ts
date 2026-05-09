import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { decrypt, encrypt } from "../crypto";
import type { EncryptedBlob } from "../types";

export interface TechTraxRequestOpts {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  ifUnmodifiedSince?: string;
  idempotencyKey?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface TechTraxResponse<T = unknown> {
  data: T;
  status: number;
  lastModified?: string;
  etag?: string;
}

export interface TechTraxError {
  code: string;
  retryable: boolean;
  message?: string;
  status?: number;
  currentUpdatedAt?: string;
  details?: unknown;
}

interface ClientArgs {
  uid: string;
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  encryptedPasswordCt: EncryptedBlob;
  email: string;
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

function buildQuery(query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    usp.append(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

/**
 * Tech Trax backend often returns 4xx with `{ message: "Validation error" }` and
 * the actual field-level reasons in `errors` / `details` / `validationErrors`.
 * Surface them in the thrown message so the agent (and the audit log, and the
 * UI) can show the user something actionable instead of the generic top-level
 * message.
 */
function enrichClientErrorMessage(
  bodyJson: any,
  bodyText: string | undefined,
  statusText: string
): string {
  const top: string =
    typeof bodyJson?.message === "string"
      ? bodyJson.message
      : (bodyText || statusText || "Request failed");

  const reasons: string[] = [];
  const collect = (entries: any) => {
    if (!entries) return;
    if (Array.isArray(entries)) {
      for (const e of entries) {
        if (typeof e === "string") {
          reasons.push(e);
        } else if (e && typeof e === "object") {
          const k = e.path ?? e.field ?? e.key ?? "";
          const m = e.message ?? e.msg ?? e.error ?? "";
          reasons.push(k && m ? `${k}: ${m}` : (m || JSON.stringify(e)));
        }
      }
    } else if (typeof entries === "object") {
      for (const [k, v] of Object.entries(entries)) {
        reasons.push(typeof v === "string" ? `${k}: ${v}` : `${k}: ${JSON.stringify(v)}`);
      }
    } else if (typeof entries === "string") {
      reasons.push(entries);
    }
  };
  collect(bodyJson?.errors);
  collect(bodyJson?.details);
  collect(bodyJson?.validationErrors);
  collect(bodyJson?.error?.details);

  if (reasons.length === 0) return top;
  // Keep it readable but cap length so it doesn't flood logs.
  const detail = reasons.slice(0, 8).join(" | ").slice(0, 800);
  return `${top} — ${detail}`;
}

export class TechTraxClient {
  private uid: string;
  private baseUrl: string;
  private accessToken: string;
  private refreshToken: string;
  private encryptedPasswordCt: EncryptedBlob;
  private email: string;

  constructor(args: ClientArgs) {
    this.uid = args.uid;
    this.baseUrl = args.baseUrl.replace(/\/$/, "");
    this.accessToken = args.accessToken;
    this.refreshToken = args.refreshToken;
    this.encryptedPasswordCt = args.encryptedPasswordCt;
    this.email = args.email;
  }

  getEmail(): string {
    return this.email;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Decode the connected user's identity from the access-token JWT payload.
   * Used to resolve "me" / "assign to me" prompts without an extra API call.
   * Returns null if the token isn't a JWT or doesn't carry the expected fields.
   */
  getIdentity(): { userId: string; email?: string; tenantId?: string; role?: string } | null {
    try {
      const parts = this.accessToken.split(".");
      if (parts.length !== 3) return null;
      const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
      const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
      const userId = String(payload.userId ?? payload.sub ?? "").trim();
      if (!userId) return null;
      const out: { userId: string; email?: string; tenantId?: string; role?: string } = { userId };
      if (payload.email) out.email = String(payload.email);
      if (payload.tenantId) out.tenantId = String(payload.tenantId);
      if (payload.role) out.role = String(payload.role);
      return out;
    } catch {
      return null;
    }
  }

  async request<T = unknown>(opts: TechTraxRequestOpts): Promise<TechTraxResponse<T>> {
    let res: Response;
    try {
      res = await this.doFetch(opts, this.accessToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw {
        code: "network_error",
        retryable: true,
        message,
      } as TechTraxError;
    }

    if (res.status === 401) {
      const refreshed = await this.tryRefreshOrRelogin();
      if (!refreshed) {
        throw {
          code: "auth_failed",
          retryable: false,
          status: 401,
          message: "Tech Trax authentication failed",
        } as TechTraxError;
      }
      try {
        res = await this.doFetch(opts, this.accessToken);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw { code: "network_error", retryable: true, message } as TechTraxError;
      }
    }

    return await this.parseResponse<T>(res);
  }

  private async parseResponse<T>(res: Response): Promise<TechTraxResponse<T>> {
    const lastModified = res.headers.get("last-modified") ?? undefined;
    const etag = res.headers.get("etag") ?? undefined;
    const contentType = res.headers.get("content-type") ?? "";
    let bodyJson: any = undefined;
    let bodyText: string | undefined = undefined;
    if (contentType.includes("application/json")) {
      try {
        bodyJson = await res.json();
      } catch {
        bodyJson = undefined;
      }
    } else {
      try {
        bodyText = await res.text();
      } catch {
        bodyText = undefined;
      }
    }

    if (res.status === 412) {
      throw {
        code: "precondition_failed",
        retryable: true,
        status: 412,
        currentUpdatedAt: bodyJson?.currentUpdatedAt,
        message: bodyJson?.message ?? "Precondition failed",
        details: bodyJson,
      } as TechTraxError;
    }

    if (res.status >= 500) {
      throw {
        code: "upstream_error",
        retryable: true,
        status: res.status,
        message:
          bodyJson?.message ?? bodyText ?? res.statusText ?? "Upstream error",
      } as TechTraxError;
    }

    if (res.status >= 400) {
      throw {
        code: bodyJson?.code || "client_error",
        retryable: false,
        status: res.status,
        message: enrichClientErrorMessage(bodyJson, bodyText, res.statusText),
        details: bodyJson,
      } as TechTraxError;
    }

    return {
      data: (bodyJson ?? bodyText) as T,
      status: res.status,
      lastModified,
      etag,
    };
  }

  private async doFetch(opts: TechTraxRequestOpts, accessToken: string): Promise<Response> {
    const url = `${this.baseUrl}${opts.path}${buildQuery(opts.query)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    if (opts.ifUnmodifiedSince) headers["If-Unmodified-Since"] = opts.ifUnmodifiedSince;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    return await fetch(url, { method: opts.method, headers, body });
  }

  private async tryRefreshOrRelogin(): Promise<boolean> {
    // 1. Try refresh
    try {
      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (res.ok) {
        const json: any = await res.json().catch(() => ({}));
        const data = json?.data ?? json;
        const tokens = data?.tokens ?? data ?? {};
        const newAccess =
          tokens?.accessToken ?? tokens?.access_token ?? data?.accessToken ?? data?.access_token;
        const newRefresh =
          tokens?.refreshToken ??
          tokens?.refresh_token ??
          data?.refreshToken ??
          data?.refresh_token ??
          this.refreshToken;
        if (newAccess) {
          await this.persistTokens(newAccess, newRefresh);
          return true;
        }
      }
    } catch {
      // fall through to relogin
    }

    // 2. Relogin with stored credentials
    try {
      const password = await decrypt(this.encryptedPasswordCt);
      const res = await fetch(`${this.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ key: this.email, password }),
      });
      if (!res.ok) return false;
      const json: any = await res.json().catch(() => ({}));
      const data = json?.data ?? json;
      const tokens = data?.tokens ?? data ?? {};
      const newAccess =
        tokens?.accessToken ?? tokens?.access_token ?? data?.accessToken ?? data?.access_token;
      const newRefresh =
        tokens?.refreshToken ??
        tokens?.refresh_token ??
        data?.refreshToken ??
        data?.refresh_token;
      if (!newAccess || !newRefresh) return false;
      await this.persistTokens(newAccess, newRefresh);
      return true;
    } catch {
      return false;
    }
  }

  private async persistTokens(accessToken: string, refreshToken: string): Promise<void> {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    const expiry = decodeJwtExpiryMs(accessToken);
    const accessTokenCt = await encrypt(accessToken);
    const refreshTokenCt = await encrypt(refreshToken);
    const db = getFirestore();
    const ref = db.doc(`users/${this.uid}/connectors/tech_trax_crm`);
    const update: Record<string, unknown> = {
      accessTokenCt,
      refreshTokenCt,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (expiry) update.accessTokenExpiry = expiry;
    await ref.set(update, { merge: true });
  }
}
