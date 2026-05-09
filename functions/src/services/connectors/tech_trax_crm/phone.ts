import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * Default country guess when the agent passes a local number with no country
 * code and no `+` prefix. Tech Trax is operated from Egypt, so unprefixed
 * 10/11-digit strings starting with `01...` are most likely Egyptian mobiles.
 *
 * If your tenant grows beyond Egypt, set this from the connected user's profile
 * (e.g. read country from the Tech Trax `users/{uid}/connectors/tech_trax_crm`
 * record once we capture it during connect).
 */
const DEFAULT_COUNTRY: CountryCode = "EG";

export interface PhoneNormalizeResult {
  /** Number in strict E.164 international form, e.g. "+201012345678". */
  e164: string;
  /** Original input as received. */
  raw: string;
  /** Detected country (best guess). */
  country?: CountryCode;
  /** True iff the input was missing a country code and we inferred one. */
  inferred: boolean;
}

/**
 * Normalize a free-form phone string to E.164. Throws on numbers that can't be
 * parsed at all — caller should surface this to the agent so it can re-ask.
 *
 * Rules, in order:
 *   1. If input starts with "+" → parse directly. Country is whatever the
 *      number's prefix maps to.
 *   2. If input starts with "00" → treat as international, replace with "+".
 *   3. If input starts with "0" and is 10–11 digits → treat as local; assume
 *      DEFAULT_COUNTRY and let libphonenumber strip the trunk prefix.
 *   4. Otherwise try parsing with DEFAULT_COUNTRY as a hint.
 *
 * Examples (with DEFAULT_COUNTRY="EG"):
 *   "01012345678"        → "+201012345678"  (inferred: true)
 *   "1012345678"         → "+201012345678"  (inferred: true)
 *   "+201012345678"      → "+201012345678"  (inferred: false)
 *   "00201012345678"     → "+201012345678"  (inferred: false)
 *   "(010) 1234-5678"    → "+201012345678"
 *   "+1 415 555 0100"    → "+14155550100"   (inferred: false, country=US)
 */
export function normalizePhone(input: string): PhoneNormalizeResult {
  const raw = String(input ?? "").trim();
  if (!raw) {
    throw new Error("Phone number is empty");
  }

  let candidate = raw;
  let countryHint: CountryCode | undefined;
  let hadIntlPrefix = false;

  if (candidate.startsWith("+")) {
    hadIntlPrefix = true;
  } else if (/^00\d+/.test(candidate.replace(/\D/g, ""))) {
    // "00xx..." → "+xx..."
    const digits = candidate.replace(/\D/g, "");
    candidate = "+" + digits.slice(2);
    hadIntlPrefix = true;
  } else {
    countryHint = DEFAULT_COUNTRY;
  }

  const parsed = parsePhoneNumberFromString(candidate, countryHint);
  if (!parsed || !parsed.isValid()) {
    throw new Error(
      `Could not parse phone number "${raw}" — please provide a valid number, ideally in international format (e.g. +201012345678).`
    );
  }

  return {
    e164: parsed.number, // E.164, always with leading "+"
    raw,
    country: parsed.country,
    inferred: !hadIntlPrefix,
  };
}

/**
 * Convenience: normalize and return only the E.164 string. Logs a debug line
 * when a country code was inferred so we can audit silent rewrites.
 */
export function normalizePhoneToE164(input: string): string {
  const r = normalizePhone(input);
  if (r.inferred) {
    console.log(
      `[tech_trax_crm.phone] inferred country=${r.country} for input="${r.raw}" → ${r.e164}`
    );
  }
  return r.e164;
}
