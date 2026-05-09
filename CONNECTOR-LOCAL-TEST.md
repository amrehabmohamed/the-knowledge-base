# Tech Trax CRM Connector — Local E2E Test Guide

This is the single reference for testing the new connector locally. Update freely as we add scenarios.

## Running services

| Service | URL | Notes |
|---|---|---|
| Tech Trax backend | http://localhost:5001 | `cd inbox-repo/techtrax-backend && npm run dev` (background) |
| Tech Trax frontend | http://localhost:3000 | `cd inbox-repo/techtrax-frontend-revamped && npm run dev` (open the CRM UI side-by-side with KB chat) |
| Firebase Functions emulator | http://localhost:5002 | All 14 KB functions, incl. `connectTechTraxCrm` |
| Firestore emulator | localhost:8080 | Browse via Emulator UI |
| Auth emulator | localhost:9099 | Empty until you add a user |
| Storage emulator | localhost:9199 | For source-file uploads |
| Emulator UI | http://localhost:4000 | One pane for Auth / Firestore / Functions / Storage |
| KB frontend (Vite) | http://localhost:5174 | `npm run dev` in `apps/the-knowledge-base/` |

If anything stops, restart with:
```bash
# Tech Trax backend
cd "/Users/Amr/Downloads/Tech Trax/inbox-repo/techtrax-backend" && npm run dev

# Firebase emulators (Java required on PATH)
export JAVA_HOME=/opt/homebrew/opt/openjdk && export PATH=$JAVA_HOME/bin:$PATH
cd /Users/Amr/Downloads/apps/the-knowledge-base
firebase emulators:start --project demo-kb-local --only auth,firestore,functions,storage

# KB frontend
cd /Users/Amr/Downloads/apps/the-knowledge-base && npm run dev

# Tech Trax frontend (CRM UI — open side-by-side with KB chat for the demo)
cd "/Users/Amr/Downloads/Tech Trax/inbox-repo/techtrax-frontend-revamped" && npm run dev
```

## Credentials

### Firebase Auth (KB sign-in)
You create this yourself, once, via the Auth Emulator UI:

1. Open http://localhost:4000/auth → **Add user**
2. Suggested:
   ```
   Email:     me@test.com
   Password:  Test1234!
   ```
3. Sign in at http://localhost:5174 with those.

### Tech Trax CRM (connector creds + FE login)

The same credentials work for both the connector OAuth-equivalent and signing into the TechTrax FE at http://localhost:3000.

**Primary (connector test user)** — seeded by `scripts/seed-connector-test-user.js` (idempotent):
```
Base URL:  http://localhost:5001
FE URL:    http://localhost:3000
Email:     connector-test@techtrax.io
Password:  P@ssw0rd!
```
Role: **sales manager** (full CRM permissions). Tenant: **KB Connector Test Tenant** (`tag: connector-test`). Includes 9 default pipeline stages, 12 custom fields, 7 CRM roles. **Use this for the demo** — both KB chat and the TechTrax FE will read/write the same lead set.

**Skipping the setup wizard**: the seed script now provisions `isFirstTimeSetup: false` + working hours so login goes straight to the CRM dashboard. If you've previously been redirected to `/crm/setup-wizard` and the FE still bounces you there after re-seeding, clear stale localStorage:
```js
// Browser DevTools console on http://localhost:3000
localStorage.clear(); location.reload();
```
Then sign in fresh — `SetupGuard` will read the patched `isFirstTimeSetup: false` from the backend and let you through.

**Super admin (cross-tenant view)** — seeded by `scripts/seed-super-admin.js`:
```
FE URL:    http://localhost:3000
Email:     superadmin@techtrax.com
Password:  SuperAdmin123
```
Use only if you need a global view across tenants.

### Re-seed the Tech Trax test user
```bash
cd "/Users/Amr/Downloads/Tech Trax/inbox-repo/techtrax-backend"
node scripts/seed-connector-test-user.js
```

## Test flow (in order)

### 1. Sign in to KB
Open http://localhost:5174 → sign in with `me@test.com` / `Test1234!`.

### 2. Connect Tech Trax CRM
Settings → Connectors → click **Connect** on the Tech Trax CRM card.

In the popup:
- Base URL: `http://localhost:5001`
- Email: `connector-test@techtrax.io`
- Password: `P@ssw0rd!`

Submit. Card should flip to **Connected as connector-test@techtrax.io**.

> Google Calendar card is hidden in local emulator mode (the placeholder OAuth client triggers `invalid_client`). It works on staging/prod.

### 3. Read tools (instant — no approval card)

Open a notebook (or create one — uploads work too with storage emulator).

| Prompt | Expected | Backend call |
|---|---|---|
| *"What pipeline stages do I have in my CRM?"* | 9 stages listed with names + mandatory fields | `GET /api/crm/stages` |
| *"List my open leads"* | Empty page initially (no leads yet) | `GET /api/crm/leads` |
| *"Show me lead {id}"* (after create) | Full lead record | `GET /api/crm/leads/:id` |

### 4. Write tools (approval-gated)

#### Create a lead
*"Create a lead: Sara Khalil, sara@example.com, +201005559999, source website"*

Expected: agent calls `crm_create_lead`, **approval card appears** in chat, click **Confirm**, lead is created. Verify in:
- Mongo: lead now visible via `GET http://localhost:5001/api/crm/leads`
- Firestore Emulator UI: `auditLogs` collection has an `ok` entry
- Chat: agent reports the new lead's `_id`

#### Transition stage with smart preflight
*"Move that lead to the Working stage"*

The agent should:
1. Call `crm_list_stages` (read, instant) to find the Working stage's id
2. Call `crm_transition_stage` — preflight checks `mandatoryFields` against the lead
3. If fields are missing, agent will ask in chat (e.g., *"Working requires deal value and expected close date — what should I put?"*) — **no approval card yet**
4. Provide the values in chat
5. Agent retries with `fieldUpdates` populated → **approval card** → Confirm → both update + transition execute server-side atomically

Verify in Mongo: `LeadHistory` collection has the transition entry.

#### Update a lead
*"Set Sara's priority to high"*

Expected: agent calls `crm_update_lead` with `{fields: {priority: "high"}}`, approval card → Confirm.

#### Assign a lead
*"Assign Sara to me"* (or use a specific user id)

Expected: agent calls `crm_assign_lead`, approval card → Confirm. Note: agent currently needs a userId, not a name.

### 5. Conflict safety (optional)

Open a second terminal:
```bash
# Stale-lock test — should return 412
curl -X PATCH http://localhost:5001/api/crm/leads/<LEAD_ID> \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -H 'If-Unmodified-Since: Mon, 01 Jan 2020 00:00:00 GMT' \
  -d '{"firstName":"X"}'
```
Should return `412 Precondition Failed` with `currentUpdatedAt` in the body. Connector handles this transparently with one silent retry; you wouldn't normally see it.

```bash
# Idempotency test — same key returns the SAME lead
KEY=$(uuidgen)
for i in 1 2; do
  curl -X POST http://localhost:5001/api/crm/leads \
    -H "Authorization: Bearer <TOKEN>" \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $KEY" \
    -d '{"firstName":"Test","lastName":"Idem","phone":"+201111111111","email":"idem@test.io"}'
done
# Both responses identical, only ONE lead created in Mongo
```

## Where things live

### Code (local branches, never pushed)

| Repo | Branch | What it adds |
|---|---|---|
| `the-knowledge-base` | `feature/tech-trax-crm-connector` | The connector + framework patches + frontend wiring |
| `inbox-repo/techtrax-backend` | `feature/connector-optimistic-lock-and-idempotency` | 3 middlewares, 1 model, controller doc-passing, route wiring, seed script |

### Connector files (KB)

```
functions/src/services/connectors/tech_trax_crm/
├── client.ts            HTTP wrapper + auto-refresh + silent re-login
├── connectCallable.ts   The connectTechTraxCrm Cloud Function
├── credentialsForm.ts   The HTML form served at /techTraxCredentialsForm
├── declarations.ts      7 Gemini FunctionDeclarations
├── handlers.ts          7 handler fns + 4 preflight hooks + tools[] array
├── index.ts             ConnectorProvider definition
├── schemaCache.ts       Stages + custom fields cache (1h TTL)
└── validator.ts         Pure validators + field routers (top-level / crm / customFields)
```

### Backend additions (Tech Trax)

```
src/platform/middleware/optimisticLock.middleware.js
src/platform/middleware/idempotency.middleware.js
src/platform/utils/resourceHeaders.js
src/modules/crm/models/IdempotencyKey.model.js
scripts/seed-connector-test-user.js
```

Modified routes: `src/modules/crm/routes/lead.routes.js` (mounted middlewares).
Modified controller: `src/modules/crm/controllers/lead.controller.js` (passes lead doc to `success()` for `Last-Modified` header).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Auth token not found" / "Not authenticated" | No Firebase Auth user signed in | Create one in http://localhost:4000/auth, sign in to KB |
| Empty Connectors page | `CONNECTORS_ENABLED` env not loaded by emulator | The env file must be `functions/.env.demo-kb-local` (not `.env.local`) |
| `invalid_client` 401 from Google | Local placeholder OAuth client | GCal card is hidden in local mode by design |
| `login_invalid_response: missing tokens` | Tokens nested under `data.tokens.*` | Already patched (May 9 fix) |
| `Cannot read properties of undefined (reading 'serverTimestamp')` | Wrong firebase-admin import | Already patched (use `firebase-admin/firestore` modular) |
| `ERR_CONNECTION_REFUSED localhost:9199` | Storage emulator not started | `firebase emulators:start --only ...,storage` |
| Connector connect 500 with KMS error | KMS env var set but no key access | Leave `CONNECTOR_KMS_KEY` UNSET locally — DEV mode base64 fallback kicks in |

## Plan reference

The full design and rationale is at `/Users/Amr/.claude/plans/so-i-want-to-graceful-panda.md` — context, 7-gate spec, Plan-Validate-Approve-Execute pattern, optimistic concurrency, idempotency, references to industry sources.

## Update log

- **2026-05-09** — first run, all 5 emulators up, connect verified working through callable, ready for chat-driven E2E tests.
