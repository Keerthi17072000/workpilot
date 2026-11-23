import type { IntegrationModule } from "../integrations/contract";

// shortcut: classic OAuth app; "repo" is broad (GitHub has no read-only private-repo scope). Switch to a GitHub App
// with fine-grained read permissions before onboarding users who care about this.
export const github: IntegrationModule = {
  id: "github", displayName: "GitHub", description: "Review requests, PRs, issues, repo activity.",
  oauth: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopeSeparator: " ", pkce: false,
    clientIdEnv: "GITHUB_CLIENT_ID", clientSecretEnv: "GITHUB_CLIENT_SECRET",
    baseScopes: ["read:user"],
    scopes: { read: ["repo", "notifications"], suggest: [], execute: [] }, // no write actions planned
  },
  async identify(accessToken, f) {
    const r = await f("https://api.github.com/user", { headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`github /user failed: ${r.status}`);
    const j = (await r.json()) as { id: number; login: string };
    return { externalAccountId: String(j.id), displayName: j.login };
  },
};
