import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plug, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";
import { AppLayout } from "@/components/layout/AppLayout";
import { useConnectors } from "../hooks/useConnectors";
import { ConnectorCard } from "./ConnectorCard";

const KNOWN_PROVIDERS = ["google_calendar", "tech_trax_crm"] as const;

// In the local emulator, Google's OAuth servers reject our placeholder
// client_id (`local-dev`) with invalid_client 401. Hide the card so testers
// aren't tempted to click it. GCal continues to work in staging/prod.
const HIDDEN_PROVIDERS_LOCAL = new Set<string>(
  import.meta.env.VITE_USE_EMULATORS === "true" ? ["google_calendar"] : []
);

export function ConnectorsPage() {
  const navigate = useNavigate();
  const { connectors, loading, error, connect, disconnect } = useConnectors();

  const visible = connectors.filter(
    (c) =>
      KNOWN_PROVIDERS.includes(c.provider as (typeof KNOWN_PROVIDERS)[number]) &&
      !HIDDEN_PROVIDERS_LOCAL.has(c.provider)
  );

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="font-heading text-xl font-semibold">Connectors</h2>
        </div>

        <p className="font-body mb-6 max-w-2xl text-sm text-muted-foreground">
          Let your AI assistant act on your behalf — calendars, mail, files, and
          more.
        </p>

        <Card className="mb-6 bg-muted/40" size="sm">
          <CardContent>
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <p className="font-body text-xs text-muted-foreground">
                We only access what you authorize. Calendar writes (create,
                update, delete) require your explicit confirmation in chat each
                time.
              </p>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader variant="circular" size="lg" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <Plug className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <h3 className="font-heading text-lg font-medium text-muted-foreground">
              No connectors available yet
            </h3>
            <p className="font-body mt-1 max-w-sm text-sm text-muted-foreground/70">
              Connectors are not enabled for your account. Check back soon.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((status) => (
              <ConnectorCard
                key={status.provider}
                status={status}
                onConnect={connect}
                onDisconnect={disconnect}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
