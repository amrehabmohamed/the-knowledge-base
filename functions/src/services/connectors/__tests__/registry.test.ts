import * as assert from "assert";
import type { ConnectorProvider, ConnectorTool } from "../types";

// Mock firebase-admin/firestore BEFORE registry import.
const auditWrites: any[] = [];
const pendingDocs = new Map<string, any>();
const connectorRecords = new Map<string, any>();

const moduleCache = require.cache;

function fakeFirestore() {
  return {
    collection(name: string) {
      if (name === "auditLogs") {
        return { add: async (d: any) => { auditWrites.push(d); return { id: `a${auditWrites.length}` }; } };
      }
      if (name === "pendingActions") {
        return {
          add: async (d: any) => {
            const id = `pa${pendingDocs.size + 1}`;
            pendingDocs.set(id, d);
            return { id };
          },
          doc: (id: string) => ({
            get: async () => ({ exists: pendingDocs.has(id), data: () => pendingDocs.get(id) }),
            update: async (patch: any) => {
              pendingDocs.set(id, { ...pendingDocs.get(id), ...patch });
            },
          }),
        };
      }
      if (name === "users") {
        return {
          doc: (uid: string) => ({
            collection: (sub: string) => {
              assert.strictEqual(sub, "connectors");
              return {
                get: async () => {
                  const docs: any[] = [];
                  for (const [pid, rec] of connectorRecords.entries()) {
                    if (rec.__uid === uid) {
                      docs.push({ id: pid, data: () => rec });
                    }
                  }
                  return { forEach: (cb: any) => docs.forEach(cb) };
                },
              };
            },
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

const fakeMod = {
  getFirestore: fakeFirestore,
  FieldValue: { serverTimestamp: () => "SERVERTS" },
  Timestamp: {
    fromMillis: (ms: number) => ({ toMillis: () => ms, _ms: ms }),
    now: () => ({ toMillis: () => Date.now(), _ms: Date.now() }),
  },
};

// Inject into require cache
const resolved = require.resolve("firebase-admin/firestore");
moduleCache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: fakeMod } as any;

// Now import registry
const registry = require("../registry");
const { register, dispatch, getEnabledTools, _resetRegistry } = registry;

function makeProvider(id: string, tools: ConnectorTool[]): ConnectorProvider {
  return {
    id,
    displayName: id,
    initialScopes: [],
    fullScopes: [],
    tools,
    buildAuthClient: async () => ({} as any),
    exchangeCode: async () => ({ tokens: {}, email: "" }),
    buildAuthUrl: () => "",
    revoke: async () => {},
  };
}

async function run() {
  _resetRegistry();
  connectorRecords.clear();
  auditWrites.length = 0;
  pendingDocs.clear();

  const readTool: ConnectorTool = {
    name: "fake_read",
    class: "read",
    declaration: { name: "fake_read" } as any,
    requiredScopes: ["scope.read"],
    handler: async (args: any) => ({ ok: true, args }),
  };
  const writeTool: ConnectorTool = {
    name: "fake_write",
    class: "write",
    declaration: { name: "fake_write" } as any,
    requiredScopes: ["scope.write"],
    handler: async () => ({ written: true }),
    summarizeForApproval: (a: any) => `would write ${JSON.stringify(a)}`,
  };
  const provider = makeProvider("fake", [readTool, writeTool]);
  register(provider);

  // Connect for uid
  connectorRecords.set("fake", {
    __uid: "u1",
    provider: "fake",
    status: "connected",
    scopes: ["scope.read", "scope.write"],
  });

  const tools = await getEnabledTools("u1");
  assert.strictEqual(tools.length, 2);

  // Read dispatch
  const r1 = await dispatch("fake_read", { q: "x" }, { uid: "u1", sessionId: "s1" });
  assert.strictEqual(r1.kind, "result");
  assert.deepStrictEqual((r1 as any).data, { ok: true, args: { q: "x" } });

  // Write dispatch
  const r2 = await dispatch("fake_write", { title: "t" }, { uid: "u1", sessionId: "s1" });
  assert.strictEqual(r2.kind, "awaiting_approval");
  assert.ok((r2 as any).actionId);
  assert.ok((r2 as any).summary.includes("would write"));

  // Duplicate name
  let dupThrew = false;
  try {
    register(makeProvider("other", [readTool]));
  } catch {
    dupThrew = true;
  }
  assert.ok(dupThrew, "duplicate tool name should throw");

  // Audit logs written: read-ok, write-awaiting_approval
  assert.ok(auditWrites.some((a) => a.status === "ok"));
  assert.ok(auditWrites.some((a) => a.status === "awaiting_approval"));

  console.log("registry.test OK");
}

run().catch((e) => { console.error(e); process.exit(1); });
