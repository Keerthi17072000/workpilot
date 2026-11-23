import type { NormalizedEvent, PermissionLevel, ProviderId } from "../types";

export interface TokenSet { accessToken: string; refreshToken?: string; expiresAt?: Date; scopes?: string[] }

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  /** Slack user tokens use "user_scope". */
  scopeParam?: "scope" | "user_scope";
  scopeSeparator?: " " | ",";
  /** Always requested (identity). */
  baseScopes: string[];
  /** Additional scopes per level; connecting at `read` requests only base + read. */
  scopes: Record<PermissionLevel, string[]>;
  pkce: boolean;
  authParams?: Record<string, string>;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Providers with non-standard token responses (Slack) override this. */
  parseToken?: (json: any) => TokenSet;
}

export interface WebhookResult {
  /** Slack url_verification etc.: respond with this body and stop. */
  challenge?: string;
  /** Identifies which WorkPilot integration the events belong to. */
  externalAccountId?: string;
  events: NormalizedEvent[];
}

export interface WebhookHandler {
  secretEnv: string;
  verify(o: { secret: string; headers: Headers; rawBody: string }): boolean;
  parse(o: { headers: Headers; rawBody: string }): WebhookResult;
}

export interface ActionDefinition {
  level: PermissionLevel;           // almost always "execute"
  describe(args: unknown): string;  // shown on the approval card
  run(ctx: { accessToken: string; fetch: typeof fetch }, args: unknown): Promise<unknown>;
}

export interface SyncContext { accessToken: string; fetch: typeof fetch; now: Date }

/** Every external service is one module implementing this. Nothing outside the module knows provider details. */
export interface IntegrationModule {
  id: ProviderId;
  displayName: string;
  description: string;
  oauth: OAuthConfig;
  /** Called once after OAuth to learn which external account was connected. */
  identify(accessToken: string, f: typeof fetch): Promise<{ externalAccountId: string; displayName: string }>;
  /** Delta poll. Must be idempotent: returning an already-seen event is fine (deduped by key). */
  sync?(ctx: SyncContext, cursor: unknown): Promise<{ events: NormalizedEvent[]; cursor: unknown }>;
  webhook?: WebhookHandler;
  actions?: Record<string, ActionDefinition>;
  revoke?(accessToken: string, f: typeof fetch): Promise<void>;
}
