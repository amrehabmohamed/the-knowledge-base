import * as chrono from "chrono-node";

/**
 * Default IANA timezone for ambiguous natural-language dates ("tomorrow at 4pm").
 * Tech Trax is operated from Egypt; Calendar / CRM users are mostly there.
 * Override per-call via the second arg if needed.
 */
const DEFAULT_TZ = "Africa/Cairo";

/**
 * UTC-offset minutes for a given IANA zone at a given instant. Uses Intl —
 * no external tz database — so we get correct DST handling for free.
 */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  // Format the date as if rendered in `timeZone`, then read it back as UTC
  // and subtract from the original UTC time. Result: minutes the zone is
  // ahead of UTC at that instant.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Format a Date to RFC3339 with an explicit ±HH:MM offset for `timeZone`.
 * Calendar's events.insert wants `dateTime` as RFC3339 with offset (or
 * dateTime + separate timeZone). We always emit the offset so callers don't
 * need a separate timeZone arg.
 */
function toRfc3339(date: Date, timeZone: string): string {
  const offMin = tzOffsetMinutes(date, timeZone);
  // Build a Date that, when rendered as UTC, yields the wall time in `timeZone`.
  const wall = new Date(date.getTime() + offMin * 60000);
  const yyyy = wall.getUTCFullYear();
  const mm = String(wall.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wall.getUTCDate()).padStart(2, "0");
  const HH = String(wall.getUTCHours()).padStart(2, "0");
  const MM = String(wall.getUTCMinutes()).padStart(2, "0");
  const SS = String(wall.getUTCSeconds()).padStart(2, "0");
  const sign = offMin >= 0 ? "+" : "-";
  const absOff = Math.abs(offMin);
  const oH = String(Math.floor(absOff / 60)).padStart(2, "0");
  const oM = String(absOff % 60).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}${sign}${oH}:${oM}`;
}

export interface ParseDateTimeOpts {
  /** IANA timezone used as the reference for ambiguous strings. Default: Africa/Cairo. */
  timeZone?: string;
  /** Reference instant for relative phrases ("tomorrow"). Default: now. */
  reference?: Date;
  /**
   * If true, the returned ISO string will only have the date portion
   * (`YYYY-MM-DD`) — used for fields like DOB. Default: false.
   */
  dateOnly?: boolean;
}

export interface ParseDateTimeResult {
  /** Canonical RFC3339 with offset, or `YYYY-MM-DD` when `dateOnly`. */
  iso: string;
  /** Timezone used to resolve the date. */
  timeZone: string;
  /** True iff the input was natural language (not already a valid ISO). */
  inferred: boolean;
  /** Best-effort timestamp in ms; useful for ordering / comparisons. */
  epochMs: number;
}

/**
 * Parse a date/time-ish input into RFC3339. Accepts:
 *   - already-valid ISO 8601 strings (pass-through, normalized)
 *   - epoch ms (number) or epoch-ms-as-string
 *   - native Date
 *   - natural language ("tomorrow at 4pm", "next Monday", "in 2 weeks")
 *
 * Throws on garbage so callers can surface a ValidationPendingError to the
 * agent and have it re-ask the user.
 */
export function parseDateTime(
  input: unknown,
  opts: ParseDateTimeOpts = {}
): ParseDateTimeResult {
  const timeZone = opts.timeZone ?? DEFAULT_TZ;
  const reference = opts.reference ?? new Date();

  if (input == null) {
    throw new Error("Date/time input is empty");
  }

  let date: Date | null = null;
  let inferred = false;
  let raw: string;

  if (input instanceof Date) {
    raw = input.toISOString();
    if (!isNaN(input.getTime())) date = input;
  } else if (typeof input === "number" && Number.isFinite(input)) {
    raw = String(input);
    date = new Date(input);
  } else if (typeof input === "string") {
    raw = input.trim();
    if (!raw) throw new Error("Date/time input is empty");

    // Try strict ISO first — it's the cheapest and most common case.
    const direct = new Date(raw);
    if (!isNaN(direct.getTime()) && /\d{4}-\d{2}-\d{2}/.test(raw)) {
      date = direct;
    } else {
      // Fall through to chrono for natural language.
      const parsed = chrono.parseDate(raw, reference, { forwardDate: true });
      if (parsed) {
        date = parsed;
        inferred = true;
      }
    }
  } else {
    throw new Error(`Unsupported date/time input type: ${typeof input}`);
  }

  if (!date || isNaN(date.getTime())) {
    throw new Error(
      `Could not parse date/time "${typeof input === "string" ? input : String(input)}". ` +
        `Try ISO 8601 (e.g. 2026-05-12T15:00:00+02:00) or natural language ` +
        `(e.g. "tomorrow at 3pm", "next Monday 10am").`
    );
  }

  const iso = opts.dateOnly
    ? toDateOnly(date, timeZone)
    : toRfc3339(date, timeZone);

  return {
    iso,
    timeZone,
    inferred,
    epochMs: date.getTime(),
  };
}

function toDateOnly(date: Date, timeZone: string): string {
  // Render YYYY-MM-DD as observed in `timeZone`.
  const offMin = tzOffsetMinutes(date, timeZone);
  const wall = new Date(date.getTime() + offMin * 60000);
  const yyyy = wall.getUTCFullYear();
  const mm = String(wall.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wall.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Convenience: just give me the ISO string. */
export function parseDateTimeToIso(
  input: unknown,
  opts: ParseDateTimeOpts = {}
): string {
  return parseDateTime(input, opts).iso;
}

/**
 * Derive an end time from a start when the agent forgot to provide one.
 * Defaults to +30 minutes from start. Returned in the same timezone.
 */
export function deriveEndFromStart(
  startIso: string,
  durationMinutes = 30,
  timeZone = DEFAULT_TZ
): string {
  const start = new Date(startIso);
  if (isNaN(start.getTime())) {
    throw new Error(`Cannot derive end — start is invalid: ${startIso}`);
  }
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return toRfc3339(end, timeZone);
}
