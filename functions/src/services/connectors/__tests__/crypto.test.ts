import * as assert from "assert";

delete process.env.CONNECTOR_KMS_KEY;

import { encrypt, decrypt } from "../crypto";

async function run() {
  const plaintext = "hello-secret-token-12345";
  const blob = await encrypt(plaintext);
  assert.strictEqual(blob.dekId, "DEV");
  const back = await decrypt(blob);
  assert.strictEqual(back, plaintext);
  console.log("crypto.test OK");
}

run().catch((e) => { console.error(e); process.exit(1); });
