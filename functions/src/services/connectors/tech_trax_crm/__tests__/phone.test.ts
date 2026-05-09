import { strict as assert } from "node:assert";
import { normalizePhone, normalizePhoneToE164 } from "../phone";

const cases: Array<[string, string, boolean, string]> = [
  // [input, expected E.164, expected inferred flag, label]
  ["01012345678", "+201012345678", true, "Egyptian local with leading 0"],
  ["1012345678", "+201012345678", true, "Egyptian local without leading 0"],
  ["+201012345678", "+201012345678", false, "Egyptian E.164"],
  ["00201012345678", "+201012345678", false, "Egyptian with 00 prefix"],
  ["(010) 1234-5678", "+201012345678", true, "Egyptian formatted"],
  ["+1 415 555 0100", "+14155550100", false, "US E.164"],
  ["+44 20 7946 0958", "+442079460958", false, "UK landline"],
  ["+971 50 123 4567", "+971501234567", false, "UAE mobile"],
];

for (const [input, expected, inferred, label] of cases) {
  const r = normalizePhone(input);
  assert.equal(r.e164, expected, `${label}: expected ${expected}, got ${r.e164}`);
  assert.equal(r.inferred, inferred, `${label}: inferred mismatch`);
  assert.equal(normalizePhoneToE164(input), expected, `${label}: e164 helper`);
}

// Junk input should throw, not return.
const junk = ["", "   ", "abc", "12", "++"];
for (const j of junk) {
  let threw = false;
  try {
    normalizePhone(j);
  } catch {
    threw = true;
  }
  assert.equal(threw, true, `junk "${j}" should have thrown`);
}

console.log("phone.test OK");
