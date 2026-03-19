import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import type { DecodedIdToken } from "firebase-admin/auth";

export async function validateAuth(
  req: functions.https.Request
): Promise<DecodedIdToken> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Missing or invalid Authorization header."
    );
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Invalid or expired token."
    );
  }
}
