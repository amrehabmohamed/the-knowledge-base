import { createContext, useContext, type ReactNode } from "react";
import { useSystemStatus, type SystemStatus } from "../hooks/useSystemStatus";

interface SystemStatusContextValue {
  status: SystemStatus;
  warmUp: () => Promise<void>;
  markReady: () => void;
}

const SystemStatusContext = createContext<SystemStatusContextValue | null>(null);

export function SystemStatusProvider({ children }: { children: ReactNode }) {
  const value = useSystemStatus();
  return (
    <SystemStatusContext.Provider value={value}>
      {children}
    </SystemStatusContext.Provider>
  );
}

export function useSystemStatusContext() {
  const ctx = useContext(SystemStatusContext);
  if (!ctx) {
    throw new Error("useSystemStatusContext must be used within SystemStatusProvider");
  }
  return ctx;
}
