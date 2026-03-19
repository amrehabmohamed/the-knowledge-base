import { httpsCallable } from "firebase/functions";
import { getFunctions } from "firebase/functions";
import app from "./firebase";

const functions = getFunctions(app);

export async function callFunction<T = unknown>(
  name: string,
  data: Record<string, unknown> = {}
): Promise<T> {
  const fn = httpsCallable<Record<string, unknown>, T>(functions, name);
  const result = await fn(data);
  return result.data;
}
