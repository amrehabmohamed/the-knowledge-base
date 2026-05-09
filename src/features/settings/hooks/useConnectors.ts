import { useCallback, useEffect, useState } from "react";
import {
  getConnectorStatus,
  disconnectConnector as disconnectConnectorApi,
  startConnectorOAuth,
  type ConnectorStatus,
} from "@/lib/connectors";

interface OAuthMessage {
  type: "connector:connected" | "connector:error";
  provider: string;
  email?: string;
  error?: string;
}

export function useConnectors() {
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getConnectorStatus();
      setConnectors(list);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load connectors.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(
    async (provider: string, mode: "initial" | "expand" = "initial") => {
      const url = await startConnectorOAuth(provider, mode);
      const popup = window.open(url, "connector-oauth", "width=500,height=650");
      if (!popup) {
        throw new Error("Popup blocked. Please allow popups for this site.");
      }

      return new Promise<void>((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          const data = event.data as OAuthMessage | undefined;
          if (!data || typeof data !== "object") return;
          if (
            data.type !== "connector:connected" &&
            data.type !== "connector:error"
          ) {
            return;
          }
          if (data.provider !== provider) return;

          window.removeEventListener("message", handler);
          if (data.type === "connector:connected") {
            void refresh().then(() => resolve());
          } else {
            reject(new Error(data.error ?? "Connection failed."));
          }
        };
        window.addEventListener("message", handler);
      });
    },
    [refresh]
  );

  const disconnect = useCallback(
    async (provider: string) => {
      await disconnectConnectorApi(provider);
      await refresh();
    },
    [refresh]
  );

  return { connectors, loading, error, refresh, connect, disconnect };
}
