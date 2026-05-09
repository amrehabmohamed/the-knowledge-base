export * from "./types";
export * from "./registry";
export * from "./stateJwt";
export * from "./crypto";
export * from "./audit";
export * from "./pendingActions";
export { INVALIDATIONS, isWrite, type Invalidation } from "./invalidations";

import { register } from "./registry";

let booted = false;

export async function bootConnectors(): Promise<void> {
  if (booted) return;
  booted = true;
  if (process.env.CONNECTORS_ENABLED !== "true") return;
  const modPath = "./google_calendar/index";
  // Dynamic import to allow this module to compile before sibling provider exists.
  const mod: any = await import(/* webpackIgnore: true */ modPath);
  const provider = (mod as any).default ?? (mod as any).googleCalendarProvider;
  if (!provider) throw new Error("google_calendar provider module did not export a provider");
  register(provider);

  if (process.env.TECHTRAX_CONNECTOR_ENABLED !== "false") {
    try {
      const m: any = await import("./tech_trax_crm/index");
      const ttProvider = m.techTraxCrmProvider ?? m.default;
      if (ttProvider) register(ttProvider);
    } catch (e) {
      console.error("[connectors] Failed to register tech_trax_crm provider", e);
    }
  }
}
