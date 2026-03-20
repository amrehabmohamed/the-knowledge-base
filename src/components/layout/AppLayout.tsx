import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthContext } from "@/features/auth";
import { SystemStatus } from "@/features/settings";

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuthContext();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <h1 className="font-heading text-lg font-semibold text-foreground">
          Knowledge Base
        </h1>
        <div className="flex items-center gap-3">
          <SystemStatus />
          <span className="font-body text-sm text-muted-foreground">
            {user?.email}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/settings/archive")}
          >
            <Archive className="mr-1.5 h-4 w-4" />
            Archive
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="mr-1.5 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
