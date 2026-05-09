/**
 * Auto-correct case-mismatched enum values rejected by the Tech Trax backend.
 *
 * Tech Trax custom-field dropdowns are case-sensitive: sending `"high"` when the
 * backend expects `"High"` returns a 400 with a message like
 *   `Custom field validation failed — Field "Customer Interest" must be one of: High, Medium, Low, Not Interested`
 *
 * Rather than bouncing this back to the agent (and forcing the user to retry),
 * we parse the allowed values out of the error, find any string in the request
 * body that matches case-insensitively, replace it with the canonical casing,
 * and retry the request. Repeats until the backend accepts the body or no more
 * corrections can be applied.
 */
import type { TechTraxClient, TechTraxRequestOpts, TechTraxResponse } from "./client";

const ENUM_MSG_RE = /must\s+be\s+one\s+of\s*:?\s*([^.\n]+?)(?:\.|$)/i;
const FIELD_NAME_RE = /Field\s+"([^"]+)"/i;

interface EnumHint {
  fieldLabel?: string;
  allowed: string[];
}

function collectErrorStrings(err: any): string[] {
  const out: string[] = [];
  if (!err) return out;
  if (typeof err.message === "string") out.push(err.message);
  const d = err.details;
  if (d && typeof d === "object") {
    if (typeof d.message === "string") out.push(d.message);
    const drill = (entries: any) => {
      if (!entries) return;
      if (Array.isArray(entries)) {
        for (const e of entries) {
          if (typeof e === "string") out.push(e);
          else if (e && typeof e === "object") {
            if (typeof e.message === "string") out.push(e.message);
            if (typeof e.msg === "string") out.push(e.msg);
            if (typeof e.error === "string") out.push(e.error);
          }
        }
      } else if (typeof entries === "object") {
        for (const v of Object.values(entries)) {
          if (typeof v === "string") out.push(v);
        }
      } else if (typeof entries === "string") {
        out.push(entries);
      }
    };
    drill(d.errors);
    drill(d.details);
    drill(d.validationErrors);
    drill(d.error?.details);
  }
  return out;
}

export function parseEnumError(err: any): EnumHint | null {
  for (const s of collectErrorStrings(err)) {
    const m = ENUM_MSG_RE.exec(s);
    if (!m) continue;
    // Strip wrapping brackets/parens — backends sometimes format the list as
    // `[low, high]` or `(low, high)` instead of plain `low, high`.
    const inner = m[1].trim().replace(/^[\[(]|[\])]$/g, "");
    const allowed = inner
      .split(",")
      .map((x) => x.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    if (allowed.length === 0) continue;
    const fieldMatch = FIELD_NAME_RE.exec(s);
    return {
      fieldLabel: fieldMatch?.[1],
      allowed,
    };
  }
  return null;
}

export interface Correction {
  path: string;
  from: string;
  to: string;
}

/**
 * Walk the body and replace any string value that matches one of `allowed`
 * (case-insensitively) with its canonical casing. Mutates `body` in place.
 * Skips already-canonical values so we never report a no-op correction.
 */
export function applyCaseCorrection(
  body: any,
  allowed: string[]
): Correction[] {
  const lowerToCanonical = new Map<string, string>();
  for (const v of allowed) {
    const key = v.toLowerCase().trim();
    if (key) lowerToCanonical.set(key, v);
  }
  const corrections: Correction[] = [];

  const walk = (node: any, path: string) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v = node[i];
        if (typeof v === "string") {
          const canonical = lowerToCanonical.get(v.toLowerCase().trim());
          if (canonical && canonical !== v) {
            node[i] = canonical;
            corrections.push({ path: `${path}[${i}]`, from: v, to: canonical });
          }
        } else {
          walk(v, `${path}[${i}]`);
        }
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      const sub = path ? `${path}.${k}` : k;
      if (typeof v === "string") {
        const canonical = lowerToCanonical.get(v.toLowerCase().trim());
        if (canonical && canonical !== v) {
          (node as any)[k] = canonical;
          corrections.push({ path: sub, from: v, to: canonical });
        }
      } else if (v && typeof v === "object") {
        walk(v, sub);
      }
    }
  };

  walk(body, "");
  return corrections;
}

const MAX_RETRIES = 3;

/**
 * Issue a write request through the Tech Trax client; if the backend rejects it
 * with a case-mismatched enum value, auto-correct the body and retry. Bounded
 * retries so we never loop on a value the schema legitimately doesn't accept.
 *
 * Returns the original response shape; the corrections applied (if any) are
 * surfaced back to the caller via the `corrections` callback so handlers can
 * include them in the response or audit log.
 */
export async function requestWithEnumRetry<T = unknown>(
  client: TechTraxClient,
  opts: TechTraxRequestOpts,
  onCorrections?: (c: Correction[]) => void
): Promise<TechTraxResponse<T>> {
  const allCorrections: Correction[] = [];
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await client.request<T>(opts);
      if (allCorrections.length > 0) onCorrections?.(allCorrections);
      return resp;
    } catch (err: any) {
      lastErr = err;
      // Only auto-correct on 4xx client errors with a body to mutate.
      if (
        !err ||
        err.code === "network_error" ||
        err.code === "auth_failed" ||
        err.code === "precondition_failed" ||
        err.code === "upstream_error" ||
        !opts.body ||
        typeof opts.body !== "object"
      ) {
        throw err;
      }
      const hint = parseEnumError(err);
      if (!hint) {
        // Not an enum mismatch — try to coach other common Joi shapes
        // (required / email / date / regex) before giving up.
        const coached = coachJoiError(err);
        if (coached) throw coached;
        throw err;
      }
      const corrections = applyCaseCorrection(opts.body, hint.allowed);
      if (corrections.length === 0) {
        // Enum mismatch we can't auto-fix (e.g. user said "normal" for a field
        // whose options are [low, high]). Throw a coaching error so the agent
        // tells the user the exact options instead of dumping a raw 400.
        throw buildEnumChoiceError(err, hint);
      }
      allCorrections.push(...corrections);
      console.log(
        `[tech_trax_crm] auto-corrected enum casing` +
          (hint.fieldLabel ? ` for "${hint.fieldLabel}"` : "") +
          `: ${corrections.map((c) => `${c.from}→${c.to}`).join(", ")} (retry ${attempt + 1})`
      );
    }
  }
  // Retries exhausted. If the final error is still enum-shaped, coach it;
  // otherwise try the generic Joi coach; otherwise re-throw raw.
  const finalHint = parseEnumError(lastErr);
  if (finalHint) throw buildEnumChoiceError(lastErr, finalHint);
  const coached = coachJoiError(lastErr);
  if (coached) throw coached;
  throw lastErr;
}

/**
 * Convert common Joi validation messages into agent-coaching directives so
 * the user sees friendly guidance instead of raw Joi output. Returns null if
 * the error doesn't look like a Joi 4xx we can improve.
 */
export function coachJoiError(err: any): any | null {
  if (!err || typeof err !== "object") return null;
  if (err.code === "network_error" || err.code === "auth_failed") return null;
  if (err.code === "precondition_failed" || err.code === "upstream_error") return null;
  if (err.status && err.status >= 500) return null;

  const strings = collectErrorStrings(err);
  if (strings.length === 0) return null;

  // Pattern → coaching builder. Order matters: more-specific first.
  const patterns: Array<{
    re: RegExp;
    build: (m: RegExpExecArray) => { code: string; message: string };
  }> = [
    {
      re: /"?([\w.[\]]+)"?\s+must be a valid email/i,
      build: (m) => ({
        code: "invalid_email",
        message:
          `The "${m[1]}" field needs a valid email address. ` +
          `Please ask the user for a properly formatted email (e.g. name@example.com).`,
      }),
    },
    {
      re: /"?([\w.[\]]+)"?\s+must be a valid date/i,
      build: (m) => ({
        code: "invalid_date",
        message:
          `The "${m[1]}" field needs a valid date. ` +
          `Please ask the user for a date (e.g. "tomorrow at 4pm" or "2026-06-15").`,
      }),
    },
    {
      re: /"?([\w.[\]]+)"?\s+(?:with value\s+"[^"]*"\s+)?fails to match the required pattern/i,
      build: (m) => ({
        code: "invalid_format",
        message:
          `The "${m[1]}" field has an invalid format. ` +
          `Please ask the user to provide it in the expected format and retry.`,
      }),
    },
    {
      re: /"?([\w.[\]]+)"?\s+length must be at least (\d+)/i,
      build: (m) => ({
        code: "too_short",
        message:
          `The "${m[1]}" field must be at least ${m[2]} characters. ` +
          `Please ask the user for a longer value.`,
      }),
    },
    {
      re: /"?([\w.[\]]+)"?\s+length must be less than or equal to (\d+)/i,
      build: (m) => ({
        code: "too_long",
        message:
          `The "${m[1]}" field must be at most ${m[2]} characters. ` +
          `Please ask the user for a shorter value.`,
      }),
    },
    {
      re: /"?([\w.[\]]+)"?\s+must be a (number|integer|boolean|string|array|object)/i,
      build: (m) => ({
        code: "invalid_type",
        message:
          `The "${m[1]}" field must be a ${m[2]}. ` +
          `Please ask the user for a valid value.`,
      }),
    },
    {
      re: /"?([\w.[\]]+)"?\s+is required/i,
      build: (m) => ({
        code: "missing_field",
        message:
          `The "${m[1]}" field is required. ` +
          `Please ask the user to provide it and retry.`,
      }),
    },
  ];

  for (const s of strings) {
    for (const p of patterns) {
      const m = p.re.exec(s);
      if (!m) continue;
      const built = p.build(m);
      return {
        code: built.code,
        retryable: false,
        status: err?.status ?? 400,
        message: built.message,
        details: { field: m[1], original: err?.message },
      };
    }
  }
  return null;
}

/**
 * Format `[low, high]` as `"low" or "high"` (Oxford-comma list with quotes) so
 * the agent can drop it into a friendly sentence verbatim.
 */
function formatChoices(allowed: string[]): string {
  const quoted = allowed.map((v) => `"${v}"`);
  if (quoted.length === 1) return quoted[0];
  if (quoted.length === 2) return `${quoted[0]} or ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1]}`;
}

/**
 * Build a normalized error whose `.message` reads as instructions to the
 * agent. The orchestrator surfaces handler error messages straight to chat,
 * so the wording deliberately reads like a directive: list the options, say
 * what was provided, ask the user to pick.
 */
function buildEnumChoiceError(originalErr: any, hint: EnumHint): any {
  const field = hint.fieldLabel ?? "field";
  const choices = formatChoices(hint.allowed);
  const message =
    `The "${field}" field only accepts ${choices}. ` +
    `Please ask the user which option they'd like and retry with one of those values.`;
  return {
    code: "invalid_enum_value",
    retryable: false,
    status: originalErr?.status ?? 400,
    message,
    details: {
      field: hint.fieldLabel,
      allowed: hint.allowed,
      original: originalErr?.message,
    },
  };
}
