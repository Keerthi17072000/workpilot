import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  buildAuthUrl, exchangeCode, getAccessToken, isConfigured, newVerifier, openState, PERMISSION_LEVELS, scopesFor, sealState,
  type Env, type KeyRing, type PermissionLevel, type Registry,
} from "@workpilot/core";
import type { Repo } from "./repo";

export interface Deps {
  repo: Repo;
  registry: Registry;
  env: Env;
  stateRing: KeyRing;
  fetch: typeof fetch;
  /** Validates a Supabase access token, returns the user id or null. */
  authenticate(token: string): Promise<string | null>;
}

const isLevel = (x: unknown): x is PermissionLevel => PERMISSION_LEVELS.includes(x as PermissionLevel);

export function createApp(d: Deps) {
  const app = new Hono<{ Variables: { uid: string } }>();
  const appUrl = d.env.APP_URL ?? "http://localhost:5173";
  const redirectUri = (p: string) => `${d.env.API_PUBLIC_URL ?? "http://localhost:8787"}/v1/oauth/callback/${p}`;

  app.use("*", cors({ origin: new URL(appUrl).origin })); // browsers send the origin only, never the /subpath
  app.get("/health", (c) => c.json({ ok: true }));

  // Provider callback has no Authorization header (it's a browser redirect); identity comes from the sealed state.
  app.get("/v1/oauth/callback/:provider", async (c) => {
    const fail = (reason: string) => c.redirect(`${appUrl}/integrations?error=${encodeURIComponent(reason)}`);
    const mod = d.registry.get(c.req.param("provider"));
    if (!mod) return fail("unknown_provider");
    const { code, state, error } = c.req.query();
    let st;
    try { st = openState(d.stateRing, state ?? ""); } catch { return fail("invalid_state"); }
    if (st.provider !== mod.id) return fail("invalid_state");
    if (error || !code) {
      await d.repo.audit({ userId: st.uid, actor: "user", action: "integration.connect", outcome: "denied", detail: { provider: mod.id, error } });
      return fail(error ?? "no_code");
    }
    try {
      const level = st.level as PermissionLevel;
      const tokens = await exchangeCode(mod, { code, redirectUri: redirectUri(mod.id), verifier: st.verifier, env: d.env, fetch: d.fetch });
      const who = await mod.identify(tokens.accessToken, d.fetch);
      const id = await d.repo.upsertIntegration({
        userId: st.uid, provider: mod.id, externalAccountId: who.externalAccountId, displayName: who.displayName,
        level, scopes: tokens.scopes ?? scopesFor(mod.oauth, level),
      });
      await d.repo.tokens.save(id, tokens);
      await d.repo.audit({ userId: st.uid, actor: "user", action: "integration.connected", outcome: "success", level, integrationId: id, detail: { provider: mod.id } });
      return c.redirect(`${appUrl}/integrations?connected=${mod.id}`);
    } catch (e) {
      await d.repo.audit({ userId: st.uid, actor: "system", action: "integration.connect", outcome: "error", detail: { provider: mod.id, message: (e as Error).message } });
      return fail("connect_failed");
    }
  });

  // everything below needs a valid Supabase session
  app.use("/v1/*", async (c, next) => {
    const token = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const uid = token ? await d.authenticate(token) : null;
    if (!uid) return c.json({ error: "unauthorized" }, 401);
    c.set("uid", uid);
    await next();
  });

  app.get("/v1/providers", (c) =>
    c.json(d.registry.list().map((m) => ({
      id: m.id, displayName: m.displayName, description: m.description,
      configured: isConfigured(m, d.env), requiredEnv: [m.oauth.clientIdEnv, m.oauth.clientSecretEnv],
      scopes: Object.fromEntries(PERMISSION_LEVELS.map((l) => [l, scopesFor(m.oauth, l)])),
    }))));

  const startConsent = (provider: string, uid: string, level: PermissionLevel) => {
    const mod = d.registry.get(provider)!;
    const verifier = newVerifier();
    const state = sealState(d.stateRing, { uid, provider, level, verifier });
    return buildAuthUrl(mod, { clientId: d.env[mod.oauth.clientIdEnv]!, redirectUri: redirectUri(provider), level, state, verifier });
  };

  app.post("/v1/integrations/connect", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const mod = d.registry.get(body.provider);
    if (!mod || !isLevel(body.level)) return c.json({ error: "bad_request" }, 400);
    if (!isConfigured(mod, d.env)) return c.json({ error: "not_configured", requiredEnv: [mod.oauth.clientIdEnv, mod.oauth.clientSecretEnv] }, 503);
    return c.json({ url: startConsent(mod.id, c.get("uid"), body.level) });
  });

  // Lowering the cap is immediate. Raising it needs scopes we don't have yet -> returns a re-consent URL.
  app.patch("/v1/integrations/:id/level", async (c) => {
    const uid = c.get("uid");
    const body = await c.req.json().catch(() => ({}));
    const row = await d.repo.getIntegration(uid, c.req.param("id"));
    const mod = row && d.registry.get(row.provider);
    if (!row || !mod || !isLevel(body.level)) return c.json({ error: "bad_request" }, 400);
    const missing = scopesFor(mod.oauth, body.level).filter((s) => !row.granted_scopes.includes(s));
    if (missing.length) {
      if (!isConfigured(mod, d.env)) return c.json({ error: "not_configured" }, 503);
      return c.json({ reconsent: startConsent(mod.id, uid, body.level) });
    }
    await d.repo.setLevel(row.id, body.level);
    await d.repo.audit({ userId: uid, actor: "user", action: "integration.level_changed", outcome: "success", level: body.level, integrationId: row.id, detail: { from: row.permission_level, to: body.level } });
    return c.json({ ok: true });
  });

  app.delete("/v1/integrations/:id", async (c) => {
    const uid = c.get("uid");
    const row = await d.repo.getIntegration(uid, c.req.param("id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    const mod = d.registry.get(row.provider);
    let revoked = false;
    if (mod?.revoke) { // best effort: never block a disconnect on the provider being reachable
      try { await mod.revoke(await getAccessToken({ store: d.repo.tokens, module: mod, integrationId: row.id, env: d.env, fetch: d.fetch }), d.fetch); revoked = true; } catch { /* logged below */ }
    }
    await d.repo.audit({ userId: uid, actor: "user", action: "integration.disconnected", outcome: "success", integrationId: row.id, detail: { provider: row.provider, revokedAtProvider: revoked } });
    await d.repo.deleteIntegration(row.id); // cascades oauth_tokens
    return c.json({ ok: true, revokedAtProvider: revoked });
  });

  return app;
}
