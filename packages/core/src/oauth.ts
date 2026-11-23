import { createHash, randomBytes } from "node:crypto";
import type { IntegrationModule, OAuthConfig, TokenSet } from "./integrations/contract";
import { PERMISSION_LEVELS, type PermissionLevel } from "./types";

export const newVerifier = () => randomBytes(32).toString("base64url");
export const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");

/** base + read + (suggest) + (execute): exactly the scopes the chosen level needs, nothing more. */
export function scopesFor(c: OAuthConfig, level: PermissionLevel): string[] {
  const upto = PERMISSION_LEVELS.slice(0, PERMISSION_LEVELS.indexOf(level) + 1);
  return [...new Set([...c.baseScopes, ...upto.flatMap((l) => c.scopes[l])])];
}

export function buildAuthUrl(m: IntegrationModule, o: { clientId: string; redirectUri: string; level: PermissionLevel; state: string; verifier: string }): string {
  const c = m.oauth;
  const u = new URL(c.authUrl);
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", o.state);
  u.searchParams.set(c.scopeParam ?? "scope", scopesFor(c, o.level).join(c.scopeSeparator ?? " "));
  if (c.pkce) { u.searchParams.set("code_challenge", challengeOf(o.verifier)); u.searchParams.set("code_challenge_method", "S256"); }
  for (const [k, v] of Object.entries(c.authParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

const standardToken = (j: any, now = Date.now()): TokenSet => {
  if (!j?.access_token) throw new Error(`token response had no access_token (${j?.error ?? "unknown error"})`);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: j.expires_in ? new Date(now + Number(j.expires_in) * 1000) : undefined,
    scopes: typeof j.scope === "string" ? j.scope.split(/[ ,]/).filter(Boolean) : undefined,
  };
};

async function tokenRequest(m: IntegrationModule, params: Record<string, string>, f: typeof fetch, now?: number): Promise<TokenSet> {
  const res = await f(m.oauth.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new TokenEndpointError(res.status, json?.error ?? "token_error");
  return (m.oauth.parseToken ?? ((j) => standardToken(j, now)))(json);
}

export class TokenEndpointError extends Error {
  constructor(public status: number, public code: string) { super(`token endpoint: ${status} ${code}`); }
}

export const exchangeCode = (m: IntegrationModule, o: { code: string; redirectUri: string; verifier: string; env: Env; fetch: typeof fetch }) =>
  tokenRequest(m, {
    grant_type: "authorization_code", code: o.code, redirect_uri: o.redirectUri,
    client_id: o.env[m.oauth.clientIdEnv] ?? "", client_secret: o.env[m.oauth.clientSecretEnv] ?? "",
    ...(m.oauth.pkce ? { code_verifier: o.verifier } : {}),
  }, o.fetch);

export const refreshTokens = (m: IntegrationModule, o: { refreshToken: string; env: Env; fetch: typeof fetch; now?: number }) =>
  tokenRequest(m, {
    grant_type: "refresh_token", refresh_token: o.refreshToken,
    client_id: o.env[m.oauth.clientIdEnv] ?? "", client_secret: o.env[m.oauth.clientSecretEnv] ?? "",
  }, o.fetch, o.now);

export type Env = Record<string, string | undefined>;
export const isConfigured = (m: IntegrationModule, env: Env) => !!env[m.oauth.clientIdEnv] && !!env[m.oauth.clientSecretEnv];
