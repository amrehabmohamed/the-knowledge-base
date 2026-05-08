import { Type, type FunctionDeclaration } from "@google/genai";

export const GCAL_FREEBUSY_DECL: FunctionDeclaration = {
  name: "gcal_freebusy",
  description:
    "Find busy time blocks across calendars. Use this BEFORE creating an event when the user asks for a free slot. " +
    "Examples: { timeMin: '2026-05-08T09:00:00-04:00', timeMax: '2026-05-08T18:00:00-04:00' } or " +
    "{ timeMin: '2026-05-09T00:00:00Z', timeMax: '2026-05-10T00:00:00Z', calendarIds: ['primary','work@example.com'], timeZone: 'America/New_York' }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      timeMin: { type: Type.STRING, description: "RFC3339 lower bound." },
      timeMax: { type: Type.STRING, description: "RFC3339 upper bound." },
      calendarIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Calendar IDs to query. Defaults to ['primary'].",
      },
      timeZone: { type: Type.STRING, description: "IANA timezone." },
    },
    required: ["timeMin", "timeMax"],
  },
};

export const GCAL_LIST_EVENTS_DECL: FunctionDeclaration = {
  name: "gcal_list_events",
  description:
    "List or search the user's events in a window. Pass eventId to fetch a single event. " +
    "Examples: { timeMin: '2026-05-08T00:00:00Z', timeMax: '2026-05-15T00:00:00Z', q: 'standup' } or " +
    "{ eventId: 'abc123' }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      calendarId: { type: Type.STRING, description: "Calendar ID. Defaults to 'primary'." },
      timeMin: { type: Type.STRING },
      timeMax: { type: Type.STRING },
      q: { type: Type.STRING, description: "Free-text search across event fields." },
      eventId: { type: Type.STRING, description: "If provided, fetch this single event." },
      maxResults: { type: Type.NUMBER, description: "Default 10, max 25." },
    },
  },
};

export const GCAL_CREATE_EVENT_DECL: FunctionDeclaration = {
  name: "gcal_create_event",
  description:
    "Propose a new calendar event. THIS REQUIRES USER APPROVAL before it is created. " +
    "Examples: { summary: 'Coffee with Sam', start: { dateTime: '2026-05-09T10:00:00-04:00' }, end: { dateTime: '2026-05-09T10:30:00-04:00' } } or " +
    "{ summary: 'Project sync', start: { dateTime: '2026-05-10T14:00:00Z' }, end: { dateTime: '2026-05-10T15:00:00Z' }, attendees: [{ email: 'a@x.com' }], addMeet: true }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      calendarId: { type: Type.STRING, description: "Defaults to 'primary'." },
      summary: { type: Type.STRING },
      description: { type: Type.STRING },
      location: { type: Type.STRING },
      start: {
        type: Type.OBJECT,
        properties: {
          dateTime: { type: Type.STRING },
          timeZone: { type: Type.STRING },
        },
        required: ["dateTime"],
      },
      end: {
        type: Type.OBJECT,
        properties: {
          dateTime: { type: Type.STRING },
          timeZone: { type: Type.STRING },
        },
        required: ["dateTime"],
      },
      attendees: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            email: { type: Type.STRING },
            optional: { type: Type.BOOLEAN },
          },
          required: ["email"],
        },
      },
      addMeet: { type: Type.BOOLEAN, description: "Attach a Google Meet link." },
      recurrence: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "RRULE strings (e.g. 'RRULE:FREQ=WEEKLY;BYDAY=MO').",
      },
      reminders: {
        type: Type.OBJECT,
        properties: {
          useDefault: { type: Type.BOOLEAN },
          overrides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                method: { type: Type.STRING, description: "'email' or 'popup'." },
                minutes: { type: Type.NUMBER },
              },
              required: ["method", "minutes"],
            },
          },
        },
      },
    },
    required: ["summary", "start", "end"],
  },
};

export const GCAL_UPDATE_EVENT_DECL: FunctionDeclaration = {
  name: "gcal_update_event",
  description:
    "Propose a patch to an existing event. THIS REQUIRES USER APPROVAL. " +
    "Examples: { eventId: 'abc123', patch: { summary: 'New title' } } or " +
    "{ eventId: 'abc123', patch: { start: { dateTime: '2026-05-11T10:00:00-04:00' }, end: { dateTime: '2026-05-11T10:30:00-04:00' }, addMeet: true } }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      calendarId: { type: Type.STRING, description: "Defaults to 'primary'." },
      eventId: { type: Type.STRING },
      patch: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          description: { type: Type.STRING },
          location: { type: Type.STRING },
          start: {
            type: Type.OBJECT,
            properties: {
              dateTime: { type: Type.STRING },
              timeZone: { type: Type.STRING },
            },
          },
          end: {
            type: Type.OBJECT,
            properties: {
              dateTime: { type: Type.STRING },
              timeZone: { type: Type.STRING },
            },
          },
          attendees: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                email: { type: Type.STRING },
                optional: { type: Type.BOOLEAN },
              },
              required: ["email"],
            },
          },
          addMeet: { type: Type.BOOLEAN },
          recurrence: { type: Type.ARRAY, items: { type: Type.STRING } },
          reminders: {
            type: Type.OBJECT,
            properties: {
              useDefault: { type: Type.BOOLEAN },
              overrides: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    method: { type: Type.STRING },
                    minutes: { type: Type.NUMBER },
                  },
                  required: ["method", "minutes"],
                },
              },
            },
          },
        },
      },
    },
    required: ["eventId", "patch"],
  },
};

export const GCAL_DELETE_EVENT_DECL: FunctionDeclaration = {
  name: "gcal_delete_event",
  description:
    "Propose deletion of an event. THIS REQUIRES USER APPROVAL. " +
    "Examples: { eventId: 'abc123' } or { eventId: 'abc123', sendUpdates: 'all' }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      calendarId: { type: Type.STRING, description: "Defaults to 'primary'." },
      eventId: { type: Type.STRING },
      sendUpdates: {
        type: Type.STRING,
        description: "'all' | 'externalOnly' | 'none'. Defaults to 'all'.",
      },
    },
    required: ["eventId"],
  },
};

export const GCAL_RESPOND_TO_EVENT_DECL: FunctionDeclaration = {
  name: "gcal_respond_to_event",
  description:
    "RSVP to an event the user is invited to. THIS REQUIRES USER APPROVAL. " +
    "Examples: { eventId: 'abc123', response: 'accepted' } or { eventId: 'abc123', response: 'declined' }.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      calendarId: { type: Type.STRING, description: "Defaults to 'primary'." },
      eventId: { type: Type.STRING },
      response: {
        type: Type.STRING,
        description: "'accepted' | 'declined' | 'tentative'.",
      },
    },
    required: ["eventId", "response"],
  },
};
