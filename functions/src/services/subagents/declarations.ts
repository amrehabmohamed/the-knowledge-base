import { Type, type FunctionDeclaration } from "@google/genai";

/**
 * FunctionDeclarations exposed to the parent orchestrator model.
 * Each maps 1:1 to a single-purpose sub-agent. Keep names + params stable —
 * the dispatcher matches on `name`.
 */

export const WEB_SEARCH_DECL: FunctionDeclaration = {
  name: "web_search",
  description:
    "Search the public web (Google) for current information. Use when the answer likely depends on info NOT in the user's uploaded sources, or for current events / news.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: "A focused search query, in natural language.",
      },
    },
    required: ["query"],
  },
};

export const MAPS_SEARCH_DECL: FunctionDeclaration = {
  name: "maps_search",
  description:
    "Search Google Maps for places, addresses, or points of interest. Use for location-aware questions.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "Natural-language place or POI query (e.g. 'coffee near Hudson Yards').",
      },
      latLng: {
        type: Type.OBJECT,
        description: "Optional center coordinate to bias the search.",
        properties: {
          latitude: { type: Type.NUMBER },
          longitude: { type: Type.NUMBER },
        },
      },
    },
    required: ["query"],
  },
};

export const URL_FETCH_DECL: FunctionDeclaration = {
  name: "url_fetch",
  description:
    "Fetch and summarize specific URLs already known to you or provided by the user. Do NOT use for open-ended web search — use web_search instead.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      urls: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Absolute URLs to fetch.",
      },
      question: {
        type: Type.STRING,
        description: "Optional question to focus the summary on.",
      },
    },
    required: ["urls"],
  },
};

export const ALL_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  WEB_SEARCH_DECL,
  MAPS_SEARCH_DECL,
  URL_FETCH_DECL,
];
