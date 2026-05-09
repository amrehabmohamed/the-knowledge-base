# TechTrax CRM — production rollout plan

## Context

The TechTrax CRM connector is fully implemented and verified end-to-end in the local Firebase emulator on `feature/tech-trax-crm-connector` (now pushed to `origin`). It runs in staging-as-code (the branch has been deployed to `the-knowledge-base-staging` configuration but not yet exercised against a real staging deploy of the connector). To get TechTrax working on the production project (`the-knowledge-base-82d72`), several things must happen across three categories:

1. **Code** — merge the feature branch into `main` so it deploys.
2. **Infrastructure** — provision KMS + secrets on the prod GCP project (one-time, mirrors what was done for staging in Phase 6).
3. **Operational** — verify the TechTrax SaaS backend is reachable from prod GCF and a real user can complete the connect → use → disconnect cycle.

Currently `functions/.env` (prod) has only `GEMINI_API_KEY`, `JINA_API_KEY`, `GEMINI_STORE_ID`, and Telegram secrets — none of the connector vars. Frontend `.env` (prod) has no `VITE_CONNECTORS_ENABLED`. So today, even if we merge to `main` and deploy, prod boots cleanly with connectors disabled (the `bootConnectors()` early-return at `functions/src/services/connectors/index.ts:16` is the safety net). Nothing breaks; nothing connector-related works.

The goal of this plan is to enumerate every step, ordered by risk, so we can roll TechTrax to prod without surprises and with a clean rollback path at every step.

## Production rollout — ordered checklist

### Phase A — pre-flight (no prod changes yet)

A1. **Confirm a production TechTrax CRM backend exists and is reachable from `us-central1` Cloud Functions egress.**
- TechTrax is multi-tenant SaaS; each KB user supplies their own tenant base URL at connect time (e.g. `https://your-tenant.techtrax.io`). KB hosts no TechTrax backend.
- **Action:** confirm with TechTrax team that production tenants exist and answer at HTTPS URLs. If users only have local/dev backends, the connector will work in form but no useful tool calls will succeed.
- Also worth confirming: TechTrax accepts traffic from Google Cloud egress IP ranges (no IP allowlist surprises).

A2. **Decide who the prod test user is.**
- We need at least one KB account on prod whose owner also has a real TechTrax tenant + login they can use to verify the full flow before any real users touch it.

A3. **Re-verify the staging CRM flow on a real `staging` deploy** (not just the local emulator).
- Right now CLAUDE.md says TechTrax is "local emulator only" — no real staging deploy of TechTrax has happened.
- **Action:** before prod, deploy this branch to staging, reproduce the multi-step Bassiouny flow against a staging TechTrax backend, confirm KMS encryption works on real KMS (not the DEV base64 fallback).

### Phase B — prod GCP infrastructure (one-time)

These mirror the Phase 6 staging steps from CLAUDE.md → "Connectors — deploy + KMS commands cheat sheet", run against `the-knowledge-base-82d72`.

B1. **Enable APIs on prod project**
- `gcloud services enable cloudkms.googleapis.com` (Calendar API only matters when GCal goes to prod — TechTrax doesn't need it).

B2. **Create KMS keyring + key**
- `gcloud kms keyrings create connectors --location=us-central1 --project=the-knowledge-base-82d72`
- `gcloud kms keys create refresh-tokens --keyring=connectors --location=us-central1 --purpose=encryption --project=the-knowledge-base-82d72`

B3. **Grant Compute SA encrypter/decrypter on the key**
- Compute SA = `<projectNumber>-compute@developer.gserviceaccount.com`. Get number via `gcloud projects describe the-knowledge-base-82d72 --format='value(projectNumber)'`.
- `gcloud kms keys add-iam-policy-binding refresh-tokens --keyring=connectors --location=us-central1 --member=serviceAccount:<SA> --role=roles/cloudkms.cryptoKeyEncrypterDecrypter --project=the-knowledge-base-82d72`

B4. **Generate a fresh state-signing secret (don't reuse staging's)**
- `openssl rand -base64 48` → save into prod env file.

### Phase C — prod env vars (ungate connectors but keep TechTrax behind its own flag)

Create `functions/.env.the-knowledge-base-82d72` with:

| Variable | Value | Why |
|---|---|---|
| `CONNECTORS_ENABLED` | `false` initially → `true` when ready | Master switch; gates `bootConnectors()` early-return at `connectors/index.ts:16` |
| `CONNECTOR_STATE_SIGNING_SECRET` | output of B4 | HS256 signing for OAuth state JWT (still used by TechTrax connect callable for state verification) |
| `CONNECTOR_KMS_KEY` | full resource name from B2 | Required for KMS envelope encryption; without it, `crypto.ts:25` falls back to base64 with a noisy warn |
| `TECHTRAX_CONNECTOR_ENABLED` | leave UNSET initially (defaults to enabled per `connectors/index.ts:24`); set to `"false"` to disable | TechTrax-specific kill switch independent of master flag |
| `TECHTRAX_CREDENTIALS_FORM_URL` | leave unset (defaults to `connectorOAuthCallback` redirect URI passed at runtime) | Optional override pointing at `techTraxCredentialsForm` Cloud Function URL |
| `SPA_ORIGIN` | e.g. `https://kb.your-domain.com` (the prod KB frontend origin) | Pins postMessage origin on the credentials form for defense-in-depth |
| `GOOGLE_OAUTH_*` (3 vars) | omit until Calendar OAuth verification is done | Only required if Google Calendar provider is invoked; framework boots fine without them as long as the Google provider isn't called |

Frontend `.env` (prod): leave `VITE_CONNECTORS_ENABLED` unset (the UI stays hidden until we explicitly add and rebuild).

### Phase D — code merge

D1. **Merge `feature/tech-trax-crm-connector` → `main`** via PR on GitHub.
- The branch is now at `origin` so a PR is openable.
- Pre-merge: re-run `cd functions && npm run build && cd .. && npx tsc --noEmit -p tsconfig.app.json` and the connector tests (`functions/lib/services/connectors/__tests__/*.test.js`, `tech_trax_crm/__tests__/caseCorrect.test.js`) on `main` after merge.

D2. **Deploy functions to prod (still gated)**
- `firebase deploy --only functions --project prod`
- With `CONNECTORS_ENABLED=false` from Phase C, this is a no-op for connectors but does ship the orchestrator/HITL/replay improvements (which apply to non-connector flows too — they're additive and we already verified them in the emulator).
- Smoke-test prod chat flow (no connectors, just FileSearch) to confirm no regressions.

D3. **Deploy Firestore rules**
- `firebase deploy --only firestore:rules --project prod`
- Adds the deny-all rules on `users/{uid}/connectors/**`, `pendingActions/**`, `auditLogs/**` (server-only via Admin SDK). No new indexes are needed for TechTrax.

### Phase E — gradual enable

E1. **Flip `CONNECTORS_ENABLED=true` on prod functions env, redeploy.**
- This boots the framework AND registers TechTrax (since `TECHTRAX_CONNECTOR_ENABLED` defaults to enabled). At this point the framework is live but the UI still doesn't expose it because `VITE_CONNECTORS_ENABLED` is unset.
- Functions surface area: `connectorOAuthStart`, `connectorOAuthCallback`, `getConnectorStatus`, `disconnectConnector`, `confirmPendingAction`, `cancelPendingAction`, `getPendingActionStatus`, `connectTechTraxCrm`, `techTraxCredentialsForm` should all appear in `gcloud functions list` output.
- Smoke: a callable like `getConnectorStatus` from the prod-test account should return `{connectors: [...]}` with TechTrax in the list, status `disconnected`.

E2. **Flip `VITE_CONNECTORS_ENABLED=true` in `.env`, rebuild + redeploy frontend hosting.**
- Prod-test account hits `/settings/connectors`, sees TechTrax + (eventually) Google Calendar.
- Click Connect for TechTrax, enter prod tenant URL + email/password, complete the credentials form, confirm `connectTechTraxCrm` callable returns success.
- Confirm `users/{uid}/connectors/tech_trax_crm` doc exists in prod Firestore with encrypted `_secrets`.

E3. **Functional smoke test on prod**
- Run a single-step prompt that exercises a read tool: "List my CRM stages." Expect the agent to call `crm_list_stages`, surface a tool-call card, and produce a text answer with the stages.
- Then a write: "Create a test lead called X Y +201234567890 x@y.com." Expect HITL approval card. Confirm. Verify the lead exists in TechTrax.
- Then the multi-step Bassiouny-style prompt. Verify the classifier + replay-dedup behavior we just shipped works on prod (no duplicate cards, no premature success, no `[continue]` leakage).

E4. **Open up to additional users (still test users, not general)**
- After E3 passes, share with a small group of internal users for 1–2 days of real usage.
- Watch `auditLogs` for unexpected `error` rows; watch Firebase functions logs for new failure modes.

E5. **Decision point: keep TechTrax ungated, or set `TECHTRAX_CONNECTOR_ENABLED=false` for rollback.**
- Setting it to `"false"` plus redeploying instantly de-registers TechTrax (the provider isn't passed to `register()` at `connectors/index.ts:28`). Other connectors and the framework keep working. Existing connected user docs aren't deleted; they just become inactive until re-enabled.

## Critical files referenced

- `functions/src/services/connectors/index.ts` — the boot gate (`CONNECTORS_ENABLED`, `TECHTRAX_CONNECTOR_ENABLED`).
- `functions/src/services/connectors/crypto.ts` — KMS envelope encryption with DEV-mode base64 fallback.
- `functions/src/services/connectors/tech_trax_crm/index.ts` — TechTrax provider wiring; reads `TECHTRAX_CREDENTIALS_FORM_URL` and `SPA_ORIGIN`.
- `functions/.env.the-knowledge-base-82d72` — to be created in Phase C.
- `firestore.rules` — already protects connector secrets; deploy in D3.
- `CLAUDE.md` — update the "Production rollout" section after E3 passes; record the exact commands run, the prod KMS key resource name, and any deviations.

## Verification

End-to-end success looks like:
1. **Pre-Phase B**: this plan reviewed; A1 confirmation from TechTrax team in writing.
2. **Post-Phase B**: `gcloud kms keys list --keyring=connectors --location=us-central1 --project=the-knowledge-base-82d72` shows `refresh-tokens`. IAM binding visible via `gcloud kms keys get-iam-policy`.
3. **Post-Phase D2**: prod chat works exactly as before (no connectors yet); orchestrator improvements ride along silently.
4. **Post-Phase E2**: prod-test user sees `/settings/connectors`, TechTrax listed.
5. **Post-Phase E3**: prod-test user successfully runs the Bassiouny-style prompt against a real prod TechTrax tenant; resulting lead visible in the TechTrax UI; audit log row in prod Firestore.
6. **Rollback drill**: at any point, setting `CONNECTORS_ENABLED=false` (master) or `TECHTRAX_CONNECTOR_ENABLED=false` (TechTrax-only) and redeploying functions disables the relevant surface in <2 minutes without any data migration.

## Open items / blockers

- **A1 (TechTrax backend availability)** — external dependency; can't proceed past Phase A without it.
- **Google OAuth verification for Calendar** — separate track; not blocking TechTrax. If Calendar is needed in prod, OAuth verification (1–4 weeks per CLAUDE.md) must finish first. TechTrax has no analogous external verification step.
- **Telegram bot in prod** — when TechTrax + connectors land in prod, the Telegram path also routes through orchestrator. Confirm that the existing prod Telegram setup still works after D2 (the orchestrator changes are backwards-compatible, but worth a manual `/help` round-trip after deploy).
- **Audit log retention** — `auditLogs` has a `ttlAt` field for 90-day TTL but the Firestore TTL policy must be applied per-collection in the prod console (or via `gcloud firestore ttl` once available). Easy to forget; one-time setup.
