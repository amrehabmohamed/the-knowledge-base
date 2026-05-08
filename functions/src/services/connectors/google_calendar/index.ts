import * as admin from "firebase-admin";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import {
  getGoogleOAuthClientId,
  getGoogleOAuthClientSecret,
} from "../../../config";
import type {
  ConnectorContext,
  ConnectorProvider,
  ConnectorTool,
  EncryptedBlob,
} from "../types";
import { decrypt, encrypt } from "../crypto";
import {
  GCAL_CREATE_EVENT_DECL,
  GCAL_DELETE_EVENT_DECL,
  GCAL_FREEBUSY_DECL,
  GCAL_LIST_EVENTS_DECL,
  GCAL_RESPOND_TO_EVENT_DECL,
  GCAL_UPDATE_EVENT_DECL,
} from "./declarations";
import {
  handleCreateEvent,
  handleDeleteEvent,
  handleFreebusy,
  handleListEvents,
  handleRespondToEvent,
  handleUpdateEvent,
} from "./handlers";

const READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const INITIAL_SCOPES = ["openid", "email", "profile", READONLY_SCOPE, FREEBUSY_SCOPE];
const FULL_SCOPES = [...INITIAL_SCOPES, EVENTS_SCOPE];

function fmtAttendees(n: number): string {
  return `${n} attendee${n === 1 ? "" : "s"}`;
}

const tools: ConnectorTool[] = [
  {
    name: "gcal_freebusy",
    class: "read",
    declaration: GCAL_FREEBUSY_DECL,
    handler: (args, ctx) => handleFreebusy(args, ctx),
    requiredScopes: [FREEBUSY_SCOPE],
  },
  {
    name: "gcal_list_events",
    class: "read",
    declaration: GCAL_LIST_EVENTS_DECL,
    handler: (args, ctx) => handleListEvents(args, ctx),
    requiredScopes: [READONLY_SCOPE],
  },
  {
    name: "gcal_create_event",
    class: "write",
    declaration: GCAL_CREATE_EVENT_DECL,
    handler: (args, ctx) => handleCreateEvent(args, ctx),
    requiredScopes: [EVENTS_SCOPE],
    summarizeForApproval: (args) => {
      const n = Array.isArray(args?.attendees) ? args.attendees.length : 0;
      const start = args?.start?.dateTime ?? "?";
      const end = args?.end?.dateTime ?? "?";
      return `Create event '${args?.summary ?? ""}' from ${start} to ${end} with ${fmtAttendees(n)}${
        args?.addMeet ? " (Meet link)" : ""
      }`;
    },
  },
  {
    name: "gcal_update_event",
    class: "write",
    declaration: GCAL_UPDATE_EVENT_DECL,
    handler: (args, ctx) => handleUpdateEvent(args, ctx),
    requiredScopes: [EVENTS_SCOPE],
    summarizeForApproval: (args) => {
      const fields = args?.patch && typeof args.patch === "object" ? Object.keys(args.patch) : [];
      return `Update event ${args?.eventId ?? ""}: ${fields.join(", ")}`;
    },
  },
  {
    name: "gcal_delete_event",
    class: "write",
    declaration: GCAL_DELETE_EVENT_DECL,
    handler: (args, ctx) => handleDeleteEvent(args, ctx),
    requiredScopes: [EVENTS_SCOPE],
    summarizeForApproval: (args) => `Delete event ${args?.eventId ?? ""}`,
  },
  {
    name: "gcal_respond_to_event",
    class: "write",
    declaration: GCAL_RESPOND_TO_EVENT_DECL,
    handler: (args, ctx) => handleRespondToEvent(args, ctx),
    requiredScopes: [EVENTS_SCOPE],
    summarizeForApproval: (args) =>
      `RSVP ${args?.response ?? ""} to event ${args?.eventId ?? ""}`,
  },
];

function newOAuth(redirectUri?: string): OAuth2Client {
  const clientId = getGoogleOAuthClientId();
  const clientSecret = getGoogleOAuthClientSecret();
  // googleapis ships its own OAuth2 from a different google-auth-library version
  // — cast through unknown to the shape the connector framework expects.
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri) as unknown as OAuth2Client;
}

export const googleCalendarProvider: ConnectorProvider = {
  id: "google_calendar",
  displayName: "Google Calendar",
  initialScopes: INITIAL_SCOPES,
  fullScopes: FULL_SCOPES,
  tools,

  buildAuthUrl(state, scopes, redirectUri) {
    const oauth = newOAuth(redirectUri);
    return oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: scopes,
      state,
    });
  },

  async exchangeCode(code, redirectUri) {
    const oauth = newOAuth(redirectUri);
    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);
    const { data } = await google.oauth2("v2").userinfo.get({ auth: oauth as any });
    if (!data.email) {
      throw new Error("oauth_userinfo_missing_email");
    }
    return { tokens, email: data.email };
  },

  async buildAuthClient(uid: string): Promise<OAuth2Client> {
    const db = admin.firestore();
    const ref = db.doc(`users/${uid}/connectors/google_calendar`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new Error("connector_not_found");
    }
    const rec = snap.data() as {
      refreshTokenCt?: EncryptedBlob;
      accessTokenCt?: EncryptedBlob;
      accessTokenExpiry?: number;
    };
    if (!rec.refreshTokenCt) {
      throw new Error("connector_missing_refresh_token");
    }
    const refreshToken = await decrypt(rec.refreshTokenCt);
    let accessToken: string | undefined;
    if (rec.accessTokenCt) {
      try {
        accessToken = await decrypt(rec.accessTokenCt);
      } catch {
        accessToken = undefined;
      }
    }
    const oauth = newOAuth();
    oauth.setCredentials({
      refresh_token: refreshToken,
      access_token: accessToken,
      expiry_date: rec.accessTokenExpiry,
    });
    // Persist rotated tokens whenever google issues a new access (or refresh) token.
    oauth.on("tokens", (t) => {
      (async () => {
        try {
          const update: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
          if (t.access_token) {
            update.accessTokenCt = await encrypt(t.access_token);
            if (t.expiry_date) update.accessTokenExpiry = t.expiry_date;
          }
          if (t.refresh_token) {
            update.refreshTokenCt = await encrypt(t.refresh_token);
          }
          await ref.set(update, { merge: true });
        } catch (e) {
          console.error("[google_calendar] failed to persist rotated tokens", e);
        }
      })();
    });
    return oauth;
  },

  async revoke(refreshToken) {
    const oauth = newOAuth();
    await oauth.revokeToken(refreshToken);
  },
};

export type { ConnectorContext };
export default googleCalendarProvider;
