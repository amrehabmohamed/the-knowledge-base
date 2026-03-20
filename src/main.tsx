import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/features/auth";
import { SystemStatusProvider } from "@/features/settings";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SystemStatusProvider>
          <App />
        </SystemStatusProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
