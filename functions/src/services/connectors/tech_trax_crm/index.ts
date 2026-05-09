import * as admin from "firebase-admin";
import type { ConnectorProvider, EncryptedBlob } from "../types";
import { decrypt } from "../crypto";
import { TechTraxClient } from "./client";
import { tools } from "./handlers";

interface TechTraxRecord {
  baseUrl?: string;
  email?: string;
  accessTokenCt?: EncryptedBlob;
  refreshTokenCt?: EncryptedBlob;
  passwordCt?: EncryptedBlob;
}

export const techTraxCrmProvider: ConnectorProvider = {
  id: "tech_trax_crm",
  displayName: "Tech Trax CRM",
  initialScopes: [],
  fullScopes: [],
  tools,

  async buildClient(uid: string): Promise<TechTraxClient> {
    const db = admin.firestore();
    const ref = db.doc(`users/${uid}/connectors/tech_trax_crm`);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("connector_not_found");
    const rec = snap.data() as TechTraxRecord;
    if (!rec.baseUrl || !rec.email) {
      throw new Error("connector_missing_config");
    }
    if (!rec.accessTokenCt || !rec.refreshTokenCt || !rec.passwordCt) {
      throw new Error("connector_missing_credentials");
    }
    const accessToken = await decrypt(rec.accessTokenCt);
    const refreshToken = await decrypt(rec.refreshTokenCt);
    return new TechTraxClient({
      uid,
      baseUrl: rec.baseUrl,
      email: rec.email,
      accessToken,
      refreshToken,
      encryptedPasswordCt: rec.passwordCt,
    });
  },

  buildAuthUrl(state: string, _scopes: string[], redirectUri: string): string {
    // The "redirectUri" here is repurposed: it points at the Cloud Functions
    // techTraxCredentialsForm endpoint. We pass through state so the form can
    // postMessage it back to the SPA after collecting credentials, plus the
    // SPA origin so the postMessage is pinned (defense-in-depth).
    const formUrl = process.env.TECHTRAX_CREDENTIALS_FORM_URL || redirectUri;
    const spaOrigin = process.env.SPA_ORIGIN || "";
    const params = new URLSearchParams({ state, redirect_uri: redirectUri });
    if (spaOrigin) params.set("origin", spaOrigin);
    return `${formUrl}?${params.toString()}`;
  },

  async exchangeCode(): Promise<{ tokens: any; email: string }> {
    throw new Error(
      "Tech Trax connector uses credentials flow, not OAuth code exchange. See connectTechTraxCrm callable."
    );
  },

  async revoke(_token: string): Promise<void> {
    // No-op: tokens are encrypted at rest and the doc is wiped on disconnect.
    return;
  },
};

export default techTraxCrmProvider;
export type { TechTraxClient };
