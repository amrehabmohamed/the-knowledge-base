import { strict as assert } from "node:assert";
import { parseDateTime, parseDateTimeToIso, deriveEndFromStart } from "../dateTime";

// Use a deterministic reference so "tomorrow" / "next monday" are stable.
// Reference: Fri 2026-05-09 10:00 UTC.
const ref = new Date("2026-05-09T10:00:00Z");

// ISO pass-through preserves the offset.
{
  const r = parseDateTime("2026-05-12T15:00:00+02:00");
  assert.equal(r.inferred, false);
  assert.equal(new Date(r.iso).toISOString(), "2026-05-12T13:00:00.000Z");
}

// Date-only mode for things like DOB.
{
  const r = parseDateTime("1990-04-15", { dateOnly: true });
  assert.equal(r.iso, "1990-04-15");
  assert.equal(r.inferred, false);
}

// Natural language — "tomorrow at 4pm" should land on 2026-05-10 16:00 in Cairo.
{
  const r = parseDateTime("tomorrow at 4pm", { reference: ref });
  assert.equal(r.inferred, true);
  // Expect RFC3339 with offset, e.g. 2026-05-10T16:00:00+03:00 (EEST).
  assert.match(r.iso, /^2026-05-10T16:00:00[+-]\d{2}:\d{2}$/);
}

// Natural language "next Monday 10am" — Monday after Fri 2026-05-09 is May 11.
{
  const r = parseDateTime("next Monday 10am", { reference: ref });
  assert.equal(r.inferred, true);
  assert.match(r.iso, /^2026-05-1[12]T10:00:00[+-]\d{2}:\d{2}$/);
}

// "in 2 weeks" — May 23.
{
  const r = parseDateTime("in 2 weeks", { reference: ref });
  assert.equal(r.inferred, true);
  assert.match(r.iso, /^2026-05-23T/);
}

// Number = epoch ms.
{
  const r = parseDateTime(1715000000000);
  assert.equal(r.inferred, false);
  // Just sanity-check it's a valid date.
  assert.ok(!isNaN(new Date(r.iso).getTime()));
}

// Garbage throws.
{
  let threw = false;
  try {
    parseDateTime("not a date at all");
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
}

// Convenience helper.
{
  const iso = parseDateTimeToIso("2026-05-12T15:00:00+02:00");
  assert.equal(typeof iso, "string");
}

// deriveEndFromStart adds 30 minutes by default. Verify by epoch comparison
// (the wall-time string varies with timezone — easier to compare instants).
{
  const start = "2026-05-12T15:00:00+02:00";
  const end = deriveEndFromStart(start);
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  assert.equal(endMs - startMs, 30 * 60 * 1000);
}

console.log("dateTime.test OK");
