import type { IntegrationModule } from "../integrations/contract";

// Linear is the first tracker; Jira is a planned second module (needs Atlassian cloud-id resolution).
export const linear: IntegrationModule = {
  id: "linear", displayName: "Linear", description: "Assigned issues, status changes, overdue/blocked work, inactivity.",
  oauth: {
    authUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopeSeparator: ",", pkce: false,
    clientIdEnv: "LINEAR_CLIENT_ID", clientSecretEnv: "LINEAR_CLIENT_SECRET",
    baseScopes: [],
    scopes: { read: ["read"], suggest: [], execute: ["issues:create", "comments:create"] },
  },
  async identify(accessToken, f) {
    const r = await f("https://api.linear.app/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "{ viewer { id name email } }" }),
    });
    const j = (await r.json()) as { data?: { viewer: { id: string; name: string; email: string } } };
    if (!j.data) throw new Error(`linear viewer query failed: ${r.status}`);
    return { externalAccountId: j.data.viewer.id, displayName: j.data.viewer.email || j.data.viewer.name };
  },
};
