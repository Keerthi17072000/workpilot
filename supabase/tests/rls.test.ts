import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// Minimal stand-in for what Supabase provides (roles, auth schema, auth.uid()).
const BOOTSTRAP = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
`;

let db: PGlite;
let alice: string;
let bob: string;

async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(readFileSync(new URL("../migrations/0001_foundation.sql", import.meta.url), "utf8"));
  const ins = async (email: string) =>
    (await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email])).rows[0]!.id;
  alice = await ins("alice@example.com");
  bob = await ins("bob@example.com");
  for (const [u, ext] of [[alice, "a@x"], [bob, "b@x"]] as const) {
    const { rows } = await db.query<{ id: string }>(
      "insert into integrations (user_id, provider, external_account_id) values ($1,'gmail',$2) returning id", [u, ext]);
    const id = rows[0]!.id;
    await db.query("insert into oauth_tokens (integration_id, user_id, access_token_enc) values ($1,$2,'secret')", [id, u]);
    await db.query("insert into notifications (user_id, dedupe_key, category, title) values ($1,'k','urgent','t')", [u]);
  }
});

describe("signup trigger", () => {
  it("creates profile + default preferences (90 min inactivity, approval required)", async () => {
    const { rows } = await db.query<{ inactivity_threshold_minutes: number; require_approval: boolean }>(
      "select inactivity_threshold_minutes, require_approval from user_preferences where user_id = $1", [alice]);
    expect(rows[0]).toEqual({ inactivity_threshold_minutes: 90, require_approval: true });
  });
});

describe("settings save", () => {
  it("a user can update exactly the preference columns the Settings page sends", async () => {
    const res = await as(alice, () => db.query(`update user_preferences set inactivity_threshold_minutes = 45,
      quiet_hours_start = '22:00', quiet_hours_end = '07:00', quiet_days = '{0,6}', suppress_during_meetings = false,
      briefing_time = '08:30', weekly_report_day = 4, require_approval = true, llm_provider = 'ollama' where user_id = $1`, [alice]));
    expect(res.affectedRows).toBe(1);
  });
  it("sending server-managed columns (user_id, timestamps) is rejected", async () => {
    await expect(as(alice, () => db.query("update user_preferences set user_id = user_id"))).rejects.toThrow(/permission denied/);
    await expect(as(alice, () => db.query("update user_preferences set created_at = now()"))).rejects.toThrow(/permission denied/);
  });
});

describe("row isolation", () => {
  it("a user sees only their own rows", async () => {
    const rows = await as(alice, async () => (await db.query<{ user_id: string }>("select user_id from notifications")).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(alice);
  });

  it("a user cannot update another user's rows", async () => {
    const res = await as(alice, () => db.query("update notifications set read_at = now() where user_id = $1", [bob]));
    expect(res.affectedRows).toBe(0);
  });

  it("a user cannot insert rows for someone else", async () => {
    await expect(as(alice, () =>
      db.query("insert into automation_workflows (user_id, name, trigger) values ($1,'x','{}')", [bob]))).rejects.toThrow();
  });

  it("anon sees nothing and cannot read", async () => {
    await expect(as(null, () => db.query("select * from notifications"))).rejects.toThrow(/permission denied/);
  });
});

describe("secrets", () => {
  it("oauth_tokens is unreadable and unwritable by authenticated users", async () => {
    await expect(as(alice, () => db.query("select * from oauth_tokens"))).rejects.toThrow(/permission denied/);
    await expect(as(alice, () => db.query("update oauth_tokens set access_token_enc = 'x'"))).rejects.toThrow(/permission denied/);
  });
});

describe("column-level grants", () => {
  it("client cannot change integration level, status or scopes (API only: re-consent + audit)", async () => {
    await expect(as(alice, () => db.query("update integrations set permission_level = 'execute'"))).rejects.toThrow(/permission denied/);
    await expect(as(alice, () => db.query("update integrations set status = 'connected'"))).rejects.toThrow(/permission denied/);
    await expect(as(alice, () => db.query("update integrations set granted_scopes = '{x}'"))).rejects.toThrow(/permission denied/);
  });

  it("client cannot approve an extracted action or rewrite the audit log", async () => {
    await expect(as(alice, () => db.query("update extracted_actions set status = 'approved'"))).rejects.toThrow(/permission denied/);
    await expect(as(alice, () => db.query("delete from activity_logs"))).rejects.toThrow(/permission denied/);
    await expect(as(alice, () => db.query("insert into activity_logs (user_id, actor, action, outcome) values ($1,'user','x','success')", [alice]))).rejects.toThrow(/permission denied/);
  });
});

describe("duplicate prevention", () => {
  it("same event / notification dedupe key cannot be stored twice", async () => {
    const { rows } = await db.query<{ id: string }>("select id from integrations where user_id = $1", [alice]);
    const iid = rows[0]!.id;
    const ev = `insert into monitored_events (user_id, integration_id, provider, kind, external_id, dedupe_key, occurred_at)
                values ($1,$2,'gmail','email.received','m1','gmail:m1', now())`;
    await db.query(ev, [alice, iid]);
    await expect(db.query(ev, [alice, iid])).rejects.toThrow(/unique/);
    await expect(db.query("insert into notifications (user_id, dedupe_key, category, title) values ($1,'k','urgent','t')", [alice])).rejects.toThrow(/unique/);
  });
});
