import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage, ProtectedRoute } from "@/features/auth";
import { NotebookListPage } from "@/features/notebooks/components/NotebookListPage";
import { NotebookWorkspacePage } from "@/features/notebooks/components/NotebookWorkspacePage";

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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
