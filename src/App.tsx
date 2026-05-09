import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage, ProtectedRoute } from "@/features/auth";
import { NotebookListPage } from "@/features/notebooks/components/NotebookListPage";
import { NotebookWorkspacePage } from "@/features/notebooks/components/NotebookWorkspacePage";
import { ArchivePage } from "@/features/settings/components/ArchivePage";
import { ArchivedSessionPage } from "@/features/settings/components/ArchivedSessionPage";
import { ConnectorsPage } from "@/features/settings/components/ConnectorsPage";
import { CONNECTORS_UI_ENABLED } from "@/config/constants";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <NotebookListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notebooks/:notebookId"
        element={
          <ProtectedRoute>
            <NotebookWorkspacePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/archive"
        element={
          <ProtectedRoute>
            <ArchivePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/archive/:notebookId/:sessionId"
        element={
          <ProtectedRoute>
            <ArchivedSessionPage />
          </ProtectedRoute>
        }
      />
      {CONNECTORS_UI_ENABLED && (
        <Route
          path="/settings/connectors"
          element={
            <ProtectedRoute>
              <ConnectorsPage />
            </ProtectedRoute>
          }
        />
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
