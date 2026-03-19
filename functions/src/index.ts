import * as functions from "firebase-functions";

// Health check endpoint
export const health = functions.https.onRequest((_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
