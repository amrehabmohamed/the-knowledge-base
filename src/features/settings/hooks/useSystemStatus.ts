import { useState, useEffect, useCallback, useRef } from "react";
import {
  HEALTH_FUNCTION_URL,
  PING_FUNCTION_URL,
  CHAT_FUNCTION_URL,
  WARMUP_TIMEOUT_MS,
  WARM_THRESHOLD_MS,
} from "@/config/constants";

export type SystemStatus = "ready" | "sleeping" | "warming" | "partial";

/** Pings an endpoint. Returns "warm" (<500ms), "cold" (responded but slow), or "failed". */
async function pingEndpoint(
  url: string,
  options?: RequestInit,
  timeoutMs = WARMUP_TIMEOUT_MS
): Promise<"warm" | "cold" | "failed"> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return Date.now() - start < WARM_THRESHOLD_MS ? "warm" : "cold";
  } catch {
    return "failed";
  }
}

const WARMUP_LONG_TIMEOUT_MS = 8_000;

export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus>("sleeping");
  const checkedRef = useRef(false);

  const checkStatus = useCallback(async () => {
    const results = await Promise.all([
      pingEndpoint(HEALTH_FUNCTION_URL),
      pingEndpoint(PING_FUNCTION_URL),
    ]);
    const warmCount = results.filter((r) => r === "warm").length;
    const respondedCount = results.filter((r) => r !== "failed").length;
    if (warmCount === results.length) setStatus("ready");
    else if (respondedCount > 0) setStatus("partial");
    else setStatus("sleeping");
  }, []);

  const warmUp = useCallback(async () => {
    setStatus("warming");
    const results = await Promise.all([
      pingEndpoint(HEALTH_FUNCTION_URL, undefined, WARMUP_LONG_TIMEOUT_MS),
      pingEndpoint(PING_FUNCTION_URL, undefined, WARMUP_LONG_TIMEOUT_MS),
      pingEndpoint(
        CHAT_FUNCTION_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ warmup: true }),
        },
        WARMUP_LONG_TIMEOUT_MS
      ),
    ]);
    // For warmup, success = all responded (even if slow — that's the point of warming up)
    const respondedCount = results.filter((r) => r !== "failed").length;
    if (respondedCount === results.length) setStatus("ready");
    else if (respondedCount > 0) setStatus("partial");
    else setStatus("sleeping");
  }, []);

  const markReady = useCallback(() => {
    setStatus("ready");
  }, []);

  useEffect(() => {
    if (!checkedRef.current) {
      checkedRef.current = true;
      checkStatus();
    }
  }, [checkStatus]);

  return { status, warmUp, markReady };
}
