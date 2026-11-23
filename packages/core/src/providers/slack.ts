import type { IntegrationModule } from "../integrations/contract";

// User-token scopes: WorkPilot reads what *you* can see (mentions, DMs, channels you're in).
export const slack: IntegrationModule = {
  id: "slack", displayName: "Slack", description: "Mentions, decisions, commitments, unresolved threads.",
  oauth: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopeParam: "user_scope", scopeSeparator: ",", pkce: false,
    clientIdEnv: "SLACK_CLIENT_ID", clientSecretEnv: "SLACK_CLIENT_SECRET",
    baseScopes: [],
    scopes: {
      read: ["channels:history", "groups:history", "im:history", "mpim:history", "channels:read", "groups:read", "users:read", "search:read"],
      suggest: [],
      execute: ["chat:write"],
    },
    // Slack nests the user token under authed_user and sends HTTP 200 even for errors.
    parseToken: (j) => {
      if (!j?.ok || !j.authed_user?.access_token) throw new Error(`slack oauth failed: ${j?.error ?? "no user token"}`);
      const u = j.authed_user;
      return {
        accessToken: u.access_token, refreshToken: u.refresh_token,
        expiresAt: u.expires_in ? new Date(Date.now() + u.expires_in * 1000) : undefined,
        scopes: typeof u.scope === "string" ? u.scope.split(",") : undefined,
      };
    },
  },
  async identify(accessToken, f) {
    const r = await f("https://slack.com/api/auth.test", { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    const j = (await r.json()) as { ok: boolean; error?: string; team_id: string; user_id: string; team: string };
    if (!j.ok) throw new Error(`slack auth.test failed: ${j.error}`);
    return { externalAccountId: `${j.team_id}:${j.user_id}`, displayName: j.team };
  },
};
