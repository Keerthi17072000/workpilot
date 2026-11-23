import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { defaultRegistry, keyRingFromEnv } from "@workpilot/core";
import { createApp } from "./app";
import { supabaseRepo } from "./repo-supabase";

const need = (k: string) => process.env[k] ?? (() => { throw new Error(`Missing required env var ${k} (see .env.example)`); })();

const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const app = createApp({
  repo: supabaseRepo(admin, keyRingFromEnv(need("TOKEN_ENCRYPTION_KEY"))),
  registry: defaultRegistry(),
  env: process.env,
  stateRing: keyRingFromEnv(need("OAUTH_STATE_KEY")),
  fetch,
  authenticate: async (token) => (await admin.auth.getUser(token)).data.user?.id ?? null,
});

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787) // hosts set PORT;
serve({ fetch: app.fetch, port }, () => console.log(`WorkPilot API on :${port}`));
