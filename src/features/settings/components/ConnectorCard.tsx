import { useState } from "react";
import { Calendar, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";
import type { ConnectorStatus } from "@/lib/connectors";

const PROVIDER_META: Record<
  string,
  { name: string; icon: React.ComponentType<{ className?: string }> }
> = {
  google_calendar: { name: "Google Calendar", icon: Calendar },
};

interface ConnectorCardProps {
  status: ConnectorStatus;
  onConnect: (provider: string, mode?: "initial" | "expand") => Promise<void>;
  onDisconnect: (provider: string) => Promise<void>;
}

function shortScope(scope: string): string {
  const parts = scope.split("/");
  return parts[parts.length - 1] || scope;
}

export function ConnectorCard({
  status,
  onConnect,
  onDisconnect,
}: ConnectorCardProps) {
  const meta = PROVIDER_META[status.provider] ?? {
    name: status.provider,
    icon: Plug,
  };
  const Icon = meta.icon;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConnect = async (mode: "initial" | "expand" = "initial") => {
    setBusy(true);
    setError(null);
    try {
      await onConnect(status.provider, mode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    try {
      await onDisconnect(status.provider);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Disconnect failed.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-base font-semibold text-foreground">
                {meta.name}
              </h3>
              {status.connected ? (
                <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Not connected
                </Badge>
              )}
            </div>
            {status.connected && status.email && (
              <p className="font-body mt-1 text-xs text-muted-foreground">
                {status.email}
              </p>
            )}
            {status.connected && status.scopes && status.scopes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {status.scopes.map((scope) => (
                  <Badge
                    key={scope}
                    variant="secondary"
                    className="font-body text-[10px]"
                  >
                    {shortScope(scope)}
                  </Badge>
                ))}
              </div>
            )}
            {error && (
              <p className="font-body mt-2 text-xs text-red-600">{error}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {status.connected ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmOpen(true)}
                >
                  {busy ? <Loader variant="circular" size="sm" /> : "Disconnect"}
                </Button>
                <button
                  type="button"
                  className="font-body text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  disabled={busy}
                  onClick={() => handleConnect("initial")}
                >
                  Reconnect
                </button>
              </>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => handleConnect("initial")}
              >
                {busy ? <Loader variant="circular" size="sm" /> : "Connect"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-heading">
              Disconnect {meta.name}?
            </DialogTitle>
            <DialogDescription className="font-body">
              The assistant will no longer be able to act on your{" "}
              {meta.name.toLowerCase()} until you reconnect. Your refresh token
              will be revoked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDisconnect}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
