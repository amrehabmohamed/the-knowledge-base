import { useCallback, useEffect, useState } from "react";
import {
  connectTechTraxCrm,
  disconnectConnector as disconnectConnectorApi,
  getConnectorStatus,
  startConnectorOAuth,
  type ConnectorStatus,
} from "@/lib/connectors";

interface OAuthMessage {
  type: "connector:connected" | "connector:error";
  provider: string;
  email?: string;
  error?: string;
}

interface TechTraxCredentialsMessage {
  type: "tech_trax_credentials";
  state: string;
  baseUrl: string;
  email: string;
  password: string;
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
        const handler = async (event: MessageEvent) => {
          const data = event.data as
            | OAuthMessage
            | TechTraxCredentialsMessage
            | undefined;
          if (!data || typeof data !== "object") return;

          // Tech Trax credentials flow: the popup hands back creds; we exchange
          // them for a JWT via the connectTechTraxCrm callable.
          if (data.type === "tech_trax_credentials") {
            window.removeEventListener("message", handler);
            try {
              const result = await connectTechTraxCrm({
                state: data.state,
                baseUrl: data.baseUrl,
                email: data.email,
                password: data.password,
              });
              if (!result.ok) {
                reject(new Error(result.message ?? "Connection failed."));
                return;
              }
              await refresh();
              resolve();
            } catch (err: unknown) {
              reject(
                err instanceof Error ? err : new Error("Connection failed.")
              );
            }
            return;
          }

          // OAuth flow (Google Calendar etc.)
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
