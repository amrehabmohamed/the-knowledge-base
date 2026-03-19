export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY not set in functions/.env");
  }
  return key;
}

export function getGeminiStoreId(): string {
  const id = process.env.GEMINI_STORE_ID;
  if (!id) {
    throw new Error("GEMINI_STORE_ID not set in functions/.env");
  }
  return id;
}
