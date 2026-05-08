import * as assert from "assert";

process.env.CONNECTOR_STATE_SIGNING_SECRET = "test-secret-do-not-use-in-prod";

import { signState, verifyState } from "../stateJwt";

function run() {
  // round-trip
  const tok = signState({ uid: "u1", provider: "google_calendar", nonce: "n1" });
  const out = verifyState(tok);
  assert.strictEqual(out.uid, "u1");
  assert.strictEqual(out.provider, "google_calendar");
  assert.strictEqual(out.nonce, "n1");

  // tamper
  const tampered = tok.slice(0, -2) + (tok.endsWith("a") ? "bb" : "aa");
  let threw = false;
  try { verifyState(tampered); } catch { threw = true; }
  assert.ok(threw, "tampered token should throw");

  // expiry
  const expired = signState({ uid: "u1", provider: "p", nonce: "n" }, -10);
  let expiredThrew = false;
  try { verifyState(expired); } catch { expiredThrew = true; }
  assert.ok(expiredThrew, "expired token should throw");

  console.log("stateJwt.test OK");
}

run();
