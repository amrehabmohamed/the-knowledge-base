# Connectors test plan — `feat/connectors-google-calendar`

Anchor date: **Fri 2026-05-08** (today). Adjust dates if testing later.

Logged-in app user: `admin@test.local` / `Admin@123` on `the-knowledge-base-staging`.
Connected Google account for OAuth: whichever Google account is in **Test users** of the consent screen.

> **Incremental authorization is on.** First-time connect grants only read scopes (`calendar.readonly` + `calendar.freebusy`). The first time you ask the agent to do a write action (create/update/delete/RSVP), the agent will surface a **"Grant access" card** in the chat — click it, complete the popup, then re-prompt. After that, all write tools work.
> If you previously connected with the merged-scopes build, you already have write scope. To exercise the proper expansion flow, disconnect on `/settings/connectors` then reconnect — that gives a clean read-only baseline to test against.

## Live debugging — keep this open in a side terminal

```
gcloud beta logging tail 'resource.type="cloud_run_revision" AND resource.labels.service_name="chat"' --project=the-knowledge-base-staging --format='value(timestamp,textPayload)'
```

In Chrome DevTools → Network → filter `chat` → click the active request → **EventStream** tab. Watch `tool_call` and `action_approval_required` events stream in real time.

---

## Track 1 — Connector alone (no FileSearch sources, no web tools)

Goal: every Calendar tool fires; HITL gate works.

| # | Prompt | Expected |
|---|---|---|
| 1.1 | `What's on my calendar today?` | `gcal_list_events` once. No approval card. Lists events. |
| 1.2 | `Am I free Monday afternoon (May 11) between 1pm and 6pm? Show me the busy blocks.` | `gcal_freebusy`. No approval card. Returns busy windows. |
| 1.3 | `Find the first 30-min free slot on Tuesday May 12 afternoon.` | `gcal_freebusy` then text reasoning. **Should NOT auto-create.** |
| 1.4 | `Book a 30-min event "Sync — Demo" tomorrow (May 9) 4:00pm with someone@example.com, add a Meet link.` | `gcal_create_event` → **approval card appears**. Confirm → event created in Calendar with `hangoutLink` and the attendee invited. Click Confirm twice fast → only one event (idempotency). |
| 1.5 | `Add a description to that event: "Demo of the connector framework. Bring questions."` | `gcal_list_events` (find it) → `gcal_update_event` → approval card → Confirm → description updated in Calendar. |
| 1.6 | `Decline the event you just created.` | `gcal_respond_to_event` with `declined` → approval card → Confirm. RSVP shows Declined in Calendar. |
| 1.7 | `Delete that event.` | `gcal_delete_event` → approval card → Confirm → event gone from Calendar. |
| 1.8 | Repeat 1.4 but click **Cancel** | Card flips to "Cancelled". No event created. Agent acknowledges. |
| 1.9 | Repeat 1.4 but wait 5+ minutes before clicking | Card auto-flips to "Expired". Confirm disabled. Backend rejects late confirm. |
| 1.10 | `Create a recurring 15-min standup every weekday next week at 9:30am.` | One `gcal_create_event` with `recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=5']` → approval card → Confirm → recurring event created. |
| 1.S | (After a fresh read-only connect) `Create a 15-min event "Quick test" tomorrow at 3pm` | Agent calls `gcal_create_event` → backend returns `scope_required` → **Grant access card appears** in chat with the missing scope listed → Click "Grant access" → popup → consent → popup closes → card flips to "Access granted". Re-prompt the same request → approval card now appears → Confirm → event created. |

---

## Track 2 — Connector + FileSearch (uploaded sources, e.g. roadmap file)

Goal: orchestrator mixes grounded retrieval with calendar action.

| # | Prompt | Expected |
|---|---|---|
| 2.1 | `What are the major milestones in the May 2026 roadmap?` | Pure FileSearch. Cites the roadmap. No calendar tools. |
| 2.2 | `Look at the May 2026 roadmap and tell me which milestone deadlines clash with anything already on my calendar.` | FileSearch (extract dates) → multiple `gcal_freebusy` or `gcal_list_events` for those date ranges → reasoning over both. No approval card. |
| 2.3 | `Create calendar reminders 1 day before each milestone in the May 2026 roadmap. Use email reminders, no attendees.` | FileSearch → for each milestone, propose `gcal_create_event` → **one approval card per event**. Confirm or Cancel each individually. |
| 2.4 | `For the biggest milestone in the May roadmap, schedule a 1-hour planning meeting with someone@example.com one week before it, in a free slot in the afternoon. Add a Meet link.` | FileSearch (find milestone + date) → `gcal_freebusy` → pick slot → `gcal_create_event` → approval card → Confirm. Event has Meet link. |
| 2.5 | `Summarize the roadmap document, then list the events I have next week. Treat them as two separate tasks.` | FileSearch citation answer + `gcal_list_events` answer in one assistant response. |

---

## Track 3 — All tools (FileSearch + web + Calendar)

Goal: no tool fights another; orchestrator routes correctly.

| # | Prompt | Expected |
|---|---|---|
| 3.1 | `When is the next public US holiday after today, and am I free that day? Use the web to confirm the date.` | `web_search` → `gcal_freebusy` → combined answer. |
| 3.2 | `Find a coworking space near downtown SF on Google Maps, then book a 2-hour event "Work session" there next Wednesday May 14 at 10am with no attendees.` | `maps_search` → `gcal_create_event` (with `location`) → approval card → Confirm → event has the address as `location`. |
| 3.3 | `Read the May 2026 roadmap file, find the milestone that mentions "release", search the web for any blog posts about that release, and book a 30-min review with someone@example.com the day after the milestone date.` | FileSearch + `web_search` + `gcal_freebusy` + `gcal_create_event` → approval card → Confirm. Should resolve in 2–3 orchestrator turns (cap = MAX_TOOL_TURNS=4). |
| 3.4 | Paste a URL with dates (e.g. an event page) and ask: `extract any dates/times from this page and offer to add them to my calendar.` | Jina prefetch → reasoning → propose calendar events → approval card per event. |

---

## Track 4 — Negative paths / regressions

| # | Action | Expected |
|---|---|---|
| 4.1 | Disconnect the connector → `What's on my calendar today?` | Tool unavailable. Agent responds gracefully ("I don't have access to your calendar"). No 500. |
| 4.2 | Connect, then revoke OAuth grant from Google Account settings → ask anything Calendar | Backend gets `invalid_grant` → handler error normalized → user sees friendly "please reconnect". Doc should mark `revoked` (verify in Firestore Console). |
| 4.3 | With `CONNECTORS_ENABLED=true` but no connector connected, run any non-calendar prompt | Behavior identical to baseline. No extra declarations leaked. |
| 4.4 | Hard-reload the page mid-pending action | Card disappears (in-memory only in v1). Backend expires the action after 5 min — verify `pendingActions/{id}.status` flips to `expired` in Firestore Console. |
| 4.5 | DevTools console: invoke `confirmPendingAction({actionId: '<another uid's id>'})` directly | Backend rejects with `permission-denied`. |

---

## What "good" looks like in the logs

For a successful read tool call you should see this sequence in the chat function logs:

```
[ROUTE] model=gemini-3-flash-preview flag=true override=none → orchestrator
[ORCH] ---- New orchestrated query ----
[ORCH] notebookId=<id>, model=gemini-3-flash-preview
[ORCH] query="..."
[ORCH] turn=0 captured 2 model part(s). keys per part: [["functionCall","thoughtSignature"],["text"]]
[ORCH] turn=0 model emitted 1 function call(s): gcal_list_events
[ORCH] turn=1 captured N model part(s). ...
```

For a successful write (HITL) sequence:

```
[ORCH] turn=0 model emitted 1 function call(s): gcal_create_event
[ORCH] turn=1 captured ... (model produces a short text turn while waiting for approval)
```

Then later, after the user clicks **Confirm**, in the `confirmPendingAction` function logs:

```
(handler runs, audit doc written, result returned to frontend)
```

In Firestore Console:
- `auditLogs/{logId}` — one row per tool execution. Status: `awaiting_approval`, `ok`, `error`, or `cancelled`.
- `pendingActions/{actionId}` — created on write proposal. Status transitions: `awaiting_approval` → `executed` | `cancelled` | `expired` | `error`.

Bad signals to watch for:
- `[connector crypto] DEV MODE` — KMS misconfigured. Fix: confirm `CONNECTOR_KMS_KEY` is set in `functions/.env.the-knowledge-base-staging` and the Functions service account has `roles/cloudkms.cryptoKeyEncrypterDecrypter` on it.
- `invalid_grant` / `Token has been expired or revoked` — refresh token rejected. User must reconnect.
- `Connector 'google_calendar' missing required scope: ...` — should NOT appear in logs anymore: registry now returns `scope_required` (no throw). If you see this, the chat function is on a stale revision; redeploy.
- `[CONNECTOR] <tool> failed: ...` — handler-level error. The full message after this prefix is the actual API response.

---

## Quick reset between test runs

If state gets weird and you want a clean slate:

1. **Disconnect** on `/settings/connectors`.
2. Firestore Console → delete the doc at `users/{uid}/connectors/google_calendar` (server-only — bypass via Console). Optional: also clear `pendingActions` and `auditLogs` for a clean log view.
3. Refresh the app. Reconnect.

---

## Where the code lives (for fast diagnosis)

| Concern | File |
|---|---|
| Provider definition (tools, scopes, OAuth methods) | `functions/src/services/connectors/google_calendar/index.ts` |
| Tool implementations | `functions/src/services/connectors/google_calendar/handlers.ts` |
| Tool declarations (Gemini schema) | `functions/src/services/connectors/google_calendar/declarations.ts` |
| Registry, dispatch, HITL gate | `functions/src/services/connectors/registry.ts` |
| OAuth start/callback HTTP handlers | `functions/src/services/connectors/oauth.ts` (helpers) and `functions/src/index.ts` (exports) |
| KMS envelope encryption | `functions/src/services/connectors/crypto.ts` |
| Audit log writer (auto-strips undefined) | `functions/src/services/connectors/audit.ts` |
| Pending actions store | `functions/src/services/connectors/pendingActions.ts` |
| Subagent dispatch fall-through to connectors | `functions/src/services/subagents/index.ts` |
| Orchestrator merging connector declarations | `functions/src/services/orchestrator.ts` |
| Chat SSE handler (forwards `action_approval_required`) | `functions/src/index.ts` (the `chat` onRequest handler) |
| Confirm/cancel callables | `functions/src/index.ts` (`confirmPendingAction`, `cancelPendingAction`) |
| Frontend connectors page | `src/features/settings/components/ConnectorsPage.tsx` |
| Frontend approval card | `src/features/chat/components/ActionApprovalCard.tsx` |
| Frontend SSE client | `src/lib/streaming.ts` |
