import * as crypto from "crypto";
import type { EncryptedBlob } from "./types";

let kmsClient: any | null = null;
let devWarned = false;

function getKmsKey(): string | null {
  return process.env.CONNECTOR_KMS_KEY || null;
}

async function getKmsClient(): Promise<any> {
  if (kmsClient) return kmsClient;
  const { KeyManagementServiceClient } = await import("@google-cloud/kms");
  kmsClient = new KeyManagementServiceClient();
  return kmsClient;
}

function devModeWarn() {
  if (!devWarned) {
    devWarned = true;
    console.warn("[connector crypto] DEV MODE: CONNECTOR_KMS_KEY unset; using base64 fallback (NOT SECURE)");
  }
}

export async function encrypt(plaintext: string): Promise<EncryptedBlob> {
  const keyName = getKmsKey();
  if (!keyName) {
    devModeWarn();
    return {
      ciphertext: Buffer.from(plaintext, "utf8").toString("base64"),
      iv: "",
      dekId: "DEV",
    };
  }
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([enc, authTag]).toString("base64");

  const client = await getKmsClient();
  const [resp] = await client.encrypt({ name: keyName, plaintext: dek });
  const wrapped: Buffer = resp.ciphertext as Buffer;
  return { ciphertext, iv: iv.toString("base64"), dekId: Buffer.from(wrapped).toString("base64") };
}

export async function decrypt(blob: EncryptedBlob): Promise<string> {
  if (blob.dekId === "DEV") {
    devModeWarn();
    return Buffer.from(blob.ciphertext, "base64").toString("utf8");
  }
  const keyName = getKmsKey();
  if (!keyName) throw new Error("CONNECTOR_KMS_KEY required to decrypt non-DEV blob");
  const client = await getKmsClient();
  const [resp] = await client.decrypt({
    name: keyName,
    ciphertext: Buffer.from(blob.dekId, "base64"),
  });
  const dek: Buffer = resp.plaintext as Buffer;
  const iv = Buffer.from(blob.iv, "base64");
  const raw = Buffer.from(blob.ciphertext, "base64");
  const authTag = raw.subarray(raw.length - 16);
  const enc = raw.subarray(0, raw.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
