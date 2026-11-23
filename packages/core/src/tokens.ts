import type { IntegrationModule, TokenSet } from "./integrations/contract";
import { refreshTokens, TokenEndpointError, type Env } from "./oauth";

export interface TokenStore {
  get(integrationId: string): Promise<TokenSet | null>;
  save(integrationId: string, t: TokenSet): Promise<void>;
  /** Refresh token was rejected: user must reconnect. */
  markReauthRequired(integrationId: string, reason: string): Promise<void>;
}

export class ReauthRequiredError extends Error {}

const SKEW_MS = 60_000;

/**
 * Returns a valid access token, refreshing (and persisting the rotated tokens) when it is within 60s of expiry.
 * shortcut: no cross-process lock, so two jobs refreshing at once may both refresh; harmless for Google/Linear
 * (both tokens stay valid). Add a row lock if a provider with single-use refresh tokens is added.
 */
export async function getAccessToken(o: { store: TokenStore; module: IntegrationModule; integrationId: string; env: Env; fetch: typeof fetch; now?: number }): Promise<string> {
  const now = o.now ?? Date.now();
  const t = await o.store.get(o.integrationId);
  if (!t) throw new ReauthRequiredError("no tokens stored");
  if (!t.expiresAt || t.expiresAt.getTime() - SKEW_MS > now) return t.accessToken;
  if (!t.refreshToken) {
    await o.store.markReauthRequired(o.integrationId, "token expired, no refresh token");
    throw new ReauthRequiredError("token expired and no refresh token");
  }
  try {
    const fresh = await refreshTokens(o.module, { refreshToken: t.refreshToken, env: o.env, fetch: o.fetch, now });
    const merged = { ...fresh, refreshToken: fresh.refreshToken ?? t.refreshToken };
    await o.store.save(o.integrationId, merged);
    return merged.accessToken;
  } catch (e) {
    // 400/401 = refresh token revoked/invalid -> reconnect. Anything else (5xx, network) is transient: let the job retry.
    if (e instanceof TokenEndpointError && (e.status === 400 || e.status === 401)) {
      await o.store.markReauthRequired(o.integrationId, e.code);
      throw new ReauthRequiredError(e.code);
    }
    throw e;
  }
}
