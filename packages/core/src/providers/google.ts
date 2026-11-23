import type { IntegrationModule } from "../integrations/contract";

const g = "https://www.googleapis.com/auth/";
const base = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  pkce: true,
  // offline + consent => a refresh token is issued; include_granted_scopes allows incremental consent
  authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  clientIdEnv: "GOOGLE_CLIENT_ID",
  clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  baseScopes: ["openid", "email"],
};

async function identify(accessToken: string, f: typeof fetch) {
  const r = await f("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`google userinfo failed: ${r.status}`);
  const j = (await r.json()) as { sub: string; email?: string };
  return { externalAccountId: j.sub, displayName: j.email ?? j.sub };
}
const revoke = async (accessToken: string, f: typeof fetch) => {
  await f("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token: accessToken }) });
};

// gmail.readonly is a Google *restricted* scope: apps used by people outside your own test users need Google's verification.
export const gmail: IntegrationModule = {
  id: "gmail", displayName: "Gmail", description: "Important emails, replies needed, follow-ups, reply drafts.",
  oauth: { ...base, scopes: { read: [g + "gmail.readonly"], suggest: [], execute: [g + "gmail.compose"] } },
  identify, revoke,
};

export const gcalendar: IntegrationModule = {
  id: "gcalendar", displayName: "Google Calendar", description: "Meetings, conflicts, briefs, quiet-time awareness.",
  oauth: { ...base, scopes: { read: [g + "calendar.readonly"], suggest: [], execute: [g + "calendar.events"] } },
  identify, revoke,
};
