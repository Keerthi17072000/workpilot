import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultRegistry, keyRingFromEnv, sealState, type TokenSet } from "@workpilot/core";
import { createApp } from "./app";
import type { AuditEntry, IntegrationRow, Repo } from "./repo";

// In-memory implementation of our own Repo interface; the provider HTTP endpoints are the only faked part.
function memRepo() {
  const integrations = new Map<string, IntegrationRow & { externalAccountId: string }>();
  const tokens = new Map<string, TokenSet>();
  const audit: AuditEntry[] = [];
  const repo: Repo = {
    tokens: { get: async (id) => tokens.get(id) ?? null, save: async (id, t) => void tokens.set(id, t), markReauthRequired: async () => {} },
    async upsertIntegration(i) {
      const key = `${i.userId}:${i.provider}:${i.externalAccountId}`;
      const existing = integrations.get(key);
      const id = existing?.id ?? `int-${integrations.size + 1}`;
      integrations.set(key, { id, user_id: i.userId, provider: i.provider, permission_level: i.level, granted_scopes: i.scopes, externalAccountId: i.externalAccountId });
      return id;
    },
    async getIntegration(userId, id) { const r = [...integrations.values()].find((x) => x.id === id && x.user_id === userId); return r ? { ...r } : null; },
    async setLevel(id, level) { for (const r of integrations.values()) if (r.id === id) r.permission_level = level; },
    async deleteIntegration(id) { for (const [k, r] of integrations) if (r.id === id) { integrations.delete(k); tokens.delete(id); } },
    async audit(e) { audit.push(e); },
  };
  return { repo, integrations, tokens, audit };
}

const stateRing = keyRingFromEnv(randomBytes(32).toString("base64"));
const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", APP_URL: "http://app", API_PUBLIC_URL: "http://api" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const providerFetch = (async (url: string) => {
  if (String(url).includes("oauth2.googleapis.com/token")) return json({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/gmail.readonly" });
  if (String(url).includes("userinfo")) return json({ sub: "g-123", email: "me@x.com" });
  if (String(url).includes("revoke")) return json({});
  return json({ error: "unexpected " + url }, 500);
}) as unknown as typeof fetch;

let mem: ReturnType<typeof memRepo>;
let app: ReturnType<typeof createApp>;
const authed = (uid = "u1") => ({ headers: { authorization: `Bearer tok-${uid}`, "content-type": "application/json" } });

beforeEach(() => {
  mem = memRepo();
  app = createApp({ repo: mem.repo, registry: defaultRegistry(), env, stateRing, fetch: providerFetch, authenticate: async (t) => t.replace("tok-", "") || null });
});

describe("cors", () => {
  it("allows the site's origin even when APP_URL has a sub-path (GitHub Pages)", async () => {
    const a = createApp({ repo: mem.repo, registry: defaultRegistry(), env: { ...env, APP_URL: "https://me.github.io/workpilot" }, stateRing, fetch: providerFetch, authenticate: async () => null });
    const r = await a.request("/v1/providers", { method: "OPTIONS", headers: { origin: "https://me.github.io", "access-control-request-method": "GET" } });
    expect(r.headers.get("access-control-allow-origin")).toBe("https://me.github.io");
    const other = await a.request("/health", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });
});

describe("auth", () => {
  it("rejects missing or invalid tokens", async () => {
    expect((await app.request("/v1/providers")).status).toBe(401);
    expect((await app.request("/v1/providers", { headers: { authorization: "Bearer " } })).status).toBe(401);
  });
  it("health is public", async () => expect((await app.request("/health")).status).toBe(200));
});

describe("providers", () => {
  it("reports which providers are configured and never returns secrets", async () => {
    const list = await (await app.request("/v1/providers", authed())).json() as any[];
    expect(list.find((p) => p.id === "gmail").configured).toBe(true);
    expect(list.find((p) => p.id === "slack").configured).toBe(false);
    expect(JSON.stringify(list)).not.toContain("sec");
  });
  it("refuses to start OAuth for an unconfigured provider, naming what's missing", async () => {
    const r = await app.request("/v1/integrations/connect", { method: "POST", ...authed(), body: JSON.stringify({ provider: "slack", level: "read" }) });
    expect(r.status).toBe(503);
    expect((await r.json() as any).requiredEnv).toEqual(["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"]);
  });
});

describe("connect flow", () => {
  const start = async (level = "read") => {
    const r = await app.request("/v1/integrations/connect", { method: "POST", ...authed(), body: JSON.stringify({ provider: "gmail", level }) });
    return new URL((await r.json() as any).url);
  };

  it("start -> callback stores an integration + tokens, audits, and redirects without leaking tokens", async () => {
    const u = await start();
    expect(u.searchParams.get("scope")).toContain("gmail.readonly");
    const cb = await app.request(`/v1/oauth/callback/gmail?code=abc&state=${encodeURIComponent(u.searchParams.get("state")!)}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("http://app/integrations?connected=gmail");
    expect(cb.headers.get("location")).not.toContain("AT");
    expect([...mem.integrations.values()][0]).toMatchObject({ user_id: "u1", provider: "gmail", permission_level: "read", externalAccountId: "g-123" });
    expect([...mem.tokens.values()][0]).toMatchObject({ accessToken: "AT", refreshToken: "RT" });
    expect(mem.audit.map((a) => a.action)).toContain("integration.connected");
  });

  it("rejects forged, expired and cross-provider state", async () => {
    const forged = await app.request("/v1/oauth/callback/gmail?code=abc&state=garbage");
    expect(forged.headers.get("location")).toContain("error=invalid_state");
    const expired = sealState(stateRing, { uid: "u1", provider: "gmail", level: "read", verifier: "v" }, -1);
    expect((await app.request(`/v1/oauth/callback/gmail?code=a&state=${expired}`)).headers.get("location")).toContain("invalid_state");
    const other = sealState(stateRing, { uid: "u1", provider: "slack", level: "read", verifier: "v" });
    expect((await app.request(`/v1/oauth/callback/gmail?code=a&state=${other}`)).headers.get("location")).toContain("invalid_state");
    expect(mem.integrations.size).toBe(0);
  });

  it("records a denied consent without creating anything", async () => {
    const u = await start();
    const cb = await app.request(`/v1/oauth/callback/gmail?error=access_denied&state=${encodeURIComponent(u.searchParams.get("state")!)}`);
    expect(cb.headers.get("location")).toContain("error=access_denied");
    expect(mem.integrations.size).toBe(0);
    expect(mem.audit[0]).toMatchObject({ outcome: "denied" });
  });
});

describe("permission level & disconnect", () => {
  const connect = async () => {
    const r = await app.request("/v1/integrations/connect", { method: "POST", ...authed(), body: JSON.stringify({ provider: "gmail", level: "read" }) });
    const state = new URL((await r.json() as any).url).searchParams.get("state")!;
    await app.request(`/v1/oauth/callback/gmail?code=abc&state=${encodeURIComponent(state)}`);
    return [...mem.integrations.values()][0]!.id;
  };

  it("raising the level needs new scopes -> returns a re-consent URL and changes nothing yet", async () => {
    const id = await connect();
    const r = await app.request(`/v1/integrations/${id}/level`, { method: "PATCH", ...authed(), body: JSON.stringify({ level: "execute" }) });
    expect(new URL((await r.json() as any).reconsent).searchParams.get("scope")).toContain("gmail.compose");
    expect([...mem.integrations.values()][0]!.permission_level).toBe("read");
  });
  it("lowering/equal-scope changes apply immediately and are audited", async () => {
    const id = await connect();
    const r = await app.request(`/v1/integrations/${id}/level`, { method: "PATCH", ...authed(), body: JSON.stringify({ level: "suggest" }) });
    expect(await r.json()).toEqual({ ok: true });
    expect(mem.audit.at(-1)).toMatchObject({ action: "integration.level_changed", detail: { from: "read", to: "suggest" } });
  });
  it("users cannot touch another user's integration", async () => {
    const id = await connect();
    expect((await app.request(`/v1/integrations/${id}`, { method: "DELETE", ...authed("u2") })).status).toBe(404);
    expect(mem.integrations.size).toBe(1);
  });
  it("disconnect revokes at the provider, deletes tokens and audits", async () => {
    const id = await connect();
    const r = await app.request(`/v1/integrations/${id}`, { method: "DELETE", ...authed() });
    expect(await r.json()).toEqual({ ok: true, revokedAtProvider: true });
    expect(mem.integrations.size).toBe(0);
    expect(mem.tokens.size).toBe(0);
    expect(mem.audit.at(-1)).toMatchObject({ action: "integration.disconnected" });
  });
});
