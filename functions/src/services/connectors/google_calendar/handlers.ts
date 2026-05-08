import * as crypto from "crypto";
import { google } from "googleapis";
import type { ConnectorContext } from "../types";

interface NormalizedError {
  code: string;
  message: string;
  retryable: boolean;
}

function toErr(e: any, fallbackCode = "internal"): NormalizedError {
  const status = e?.code || e?.response?.status;
  const message = e?.errors?.[0]?.message || e?.response?.data?.error?.message || e?.message || "unknown error";
  let code = fallbackCode;
  let retryable = false;
  if (status === 401 || /invalid_grant|unauthorized/i.test(message)) {
    code = "unauthorized";
  } else if (status === 403) {
    code = "forbidden";
  } else if (status === 404) {
    code = "not_found";
  } else if (status === 409) {
    code = "conflict";
  } else if (status === 429) {
    code = "rate_limited";
    retryable = true;
  } else if (typeof status === "number" && status >= 500) {
    code = "upstream";
    retryable = true;
  }
  return { code, message, retryable };
}

function projectEvent(ev: any) {
  if (!ev) return ev;
  return {
    id: ev.id,
    summary: ev.summary,
    description: ev.description,
    start: ev.start,
    end: ev.end,
    attendees: Array.isArray(ev.attendees)
      ? ev.attendees.map((a: any) => ({ email: a.email, responseStatus: a.responseStatus }))
      : undefined,
    location: ev.location,
    hangoutLink: ev.hangoutLink,
    htmlLink: ev.htmlLink,
  };
}

function canonicalize(obj: any): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

function makeIdemId(seed: string): string {
  // Calendar event IDs: base32hex (lowercase a-v + 0-9), 5–1024 chars.
  const hex = crypto.createHash("sha1").update(seed).digest("hex");
  // Map hex digits 0-9 a-f → 0-9 a-f (already in a-v range), pad/extend to 26 chars.
  let id = hex.slice(0, 26).toLowerCase().replace(/[^a-v0-9]/g, "a");
  if (id.length < 5) id = (id + "aaaaa").slice(0, 5);
  return id;
}

async function getUserEmail(ctx: ConnectorContext): Promise<string | undefined> {
  try {
    const { data } = await google.oauth2("v2").userinfo.get({ auth: ctx.oauth as any });
    return data.email || undefined;
  } catch {
    return undefined;
  }
}

export async function handleFreebusy(args: any, ctx: ConnectorContext) {
  if (!args?.timeMin || !args?.timeMax) {
    throw { code: "invalid_argument", message: "timeMin and timeMax are required", retryable: false };
  }
  const calendarIds: string[] = Array.isArray(args.calendarIds) && args.calendarIds.length > 0
    ? args.calendarIds
    : ["primary"];
  const cal = google.calendar({ version: "v3", auth: ctx.oauth as any });
  try {
    const { data } = await cal.freebusy.query({
      requestBody: {
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        timeZone: args.timeZone,
        items: calendarIds.map((id) => ({ id })),
      },
    });
    const calendars = data.calendars || {};
    const busy = calendarIds.map((id) => ({
      calendarId: id,
      periods: (calendars[id]?.busy || []).map((p: any) => ({ start: p.start, end: p.end })),
    }));
    return { busy };
  } catch (e) {
    throw toErr(e);
  }
}

export async function handleListEvents(args: any, ctx: ConnectorContext) {
  const calendarId = args?.calendarId || "primary";
  const cal = google.calendar({ version: "v3", auth: ctx.oauth as any });
  try {
    if (args?.eventId) {
      const { data } = await cal.events.get({ calendarId, eventId: args.eventId });
      return { events: [projectEvent(data)] };
    }
    const maxResults = Math.min(Math.max(1, Number(args?.maxResults ?? 10)), 25);
    const { data } = await cal.events.list({
      calendarId,
      timeMin: args?.timeMin,
      timeMax: args?.timeMax,
      q: args?.q,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });
    return { events: (data.items || []).map(projectEvent) };
  } catch (e) {
    throw toErr(e);
  }
}

export async function handleCreateEvent(args: any, ctx: ConnectorContext) {
  if (!args?.summary || !args?.start?.dateTime || !args?.end?.dateTime) {
    throw { code: "invalid_argument", message: "summary, start.dateTime, end.dateTime are required", retryable: false };
  }
  const calendarId = args.calendarId || "primary";
  const seed = (ctx as any).idempotencyKey || canonicalize({ uid: ctx.uid, calendarId, ...args });
  const idemId = makeIdemId(String(seed));
  const cal = google.calendar({ version: "v3", auth: ctx.oauth as any });

  const requestBody: any = {
    id: idemId,
    summary: args.summary,
    description: args.description,
    location: args.location,
    start: args.start,
    end: args.end,
    attendees: Array.isArray(args.attendees)
      ? args.attendees.map((a: any) => ({ email: a.email, optional: a.optional }))
      : undefined,
    recurrence: args.recurrence,
    reminders: args.reminders,
  };
  let conferenceDataVersion: number | undefined;
  if (args.addMeet) {
    requestBody.conferenceData = {
      createRequest: {
        requestId: idemId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
    conferenceDataVersion = 1;
  }
  try {
    const { data } = await cal.events.insert({
      calendarId,
      requestBody,
      sendUpdates: "all",
      conferenceDataVersion,
    });
    return {
      id: data.id,
      htmlLink: data.htmlLink,
      hangoutLink: data.hangoutLink,
      summary: data.summary,
      start: data.start,
      end: data.end,
    };
  } catch (e) {
    throw toErr(e);
  }
}

export async function handleUpdateEvent(args: any, ctx: ConnectorContext) {
  if (!args?.eventId || !args?.patch || typeof args.patch !== "object") {
    throw { code: "invalid_argument", message: "eventId and patch are required", retryable: false };
  }
  const calendarId = args.calendarId || "primary";
  const cal = google.calendar({ version: "v3", auth: ctx.oauth as any });
  let existing: any;
  try {
    const { data } = await cal.events.get({ calendarId, eventId: args.eventId });
    existing = data;
  } catch (e: any) {
    const norm = toErr(e);
    if (norm.code === "not_found") throw { code: "not_found", message: "event not found", retryable: false };
    throw norm;
  }
  const patch = args.patch;
  const requestBody: any = {
    summary: patch.summary,
    description: patch.description,
    location: patch.location,
    start: patch.start,
    end: patch.end,
    attendees: Array.isArray(patch.attendees)
      ? patch.attendees.map((a: any) => ({ email: a.email, optional: a.optional }))
      : undefined,
    recurrence: patch.recurrence,
    reminders: patch.reminders,
  };
  let conferenceDataVersion: number | undefined;
  if (patch.addMeet === true && !existing?.conferenceData) {
    const seedId = makeIdemId(`${ctx.uid}:${calendarId}:${args.eventId}:meet`);
    requestBody.conferenceData = {
      createRequest: {
        requestId: seedId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
    conferenceDataVersion = 1;
  }
  try {
    const { data } = await cal.events.patch({
      calendarId,
      eventId: args.eventId,
      requestBody,
      sendUpdates: "all",
      conferenceDataVersion,
    });
    return projectEvent(data);
  } catch (e) {
    throw toErr(e);
  }
}

export async function handleDeleteEvent(args: any, ctx: ConnectorContext) {
  if (!args?.eventId) {
    throw { code: "invalid_argument", message: "eventId is required", retryable: false };
  }
  const calendarId = args.calendarId || "primary";
  const cal = google.calendar({ version: "v3", auth: ctx.oauth as any });
  let summary: string | undefined;
  try {
    const { data } = await cal.events.get({ calendarId, eventId: args.eventId });
    summary = data.summary || undefined;
  } catch (e: any) {
    const norm = toErr(e);
    if (norm.code === "not_found") throw { code: "not_found", message: "event not found", retryable: false };
    throw norm;
  }
  try {
    await cal.events.delete({
      calendarId,
      eventId: args.eventId,
      sendUpdates: args.sendUpdates ?? "all",
    });
    return { deleted: true, eventId: args.eventId, summary };
  } catch (e) {
    throw toErr(e);
  }
}

export async function handleRespondToEvent(args: any, ctx: ConnectorContext) {
  if (!args?.eventId || !args?.response) {
    throw { code: "invalid_argument", message: "eventId and response are required", retryable: false };
  }
  if (!["accepted", "declined", "tentative"].includes(args.response)) {
    throw { code: "invalid_argument", message: "response must be accepted|declined|tentative", retryable: false };
  }
  const calendarId = args.calendarId || "primary";
  const cal = google.calendar({ version: "v3", auth: ctx.oauth as any });
  const email = await getUserEmail(ctx);
  if (!email) {
    throw { code: "unauthorized", message: "unable to determine user email from OAuth token", retryable: false };
  }
  let existing: any;
  try {
    const { data } = await cal.events.get({ calendarId, eventId: args.eventId });
    existing = data;
  } catch (e: any) {
    const norm = toErr(e);
    if (norm.code === "not_found") throw { code: "not_found", message: "event not found", retryable: false };
    throw norm;
  }
  const attendees: any[] = Array.isArray(existing.attendees) ? existing.attendees.slice() : [];
  const lower = email.toLowerCase();
  const idx = attendees.findIndex((a) => (a?.email || "").toLowerCase() === lower);
  if (idx === -1) {
    attendees.push({ email, responseStatus: args.response, self: true });
  } else {
    attendees[idx] = { ...attendees[idx], responseStatus: args.response };
  }
  try {
    await cal.events.patch({
      calendarId,
      eventId: args.eventId,
      requestBody: { attendees },
      sendUpdates: "all",
    });
    return { ok: true, eventId: args.eventId, response: args.response };
  } catch (e) {
    throw toErr(e);
  }
}
