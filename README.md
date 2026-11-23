# WorkPilot

AI work-automation platform: one layer over Gmail, Slack, a tracker, GitHub and Calendar. See `docs/ARCHITECTURE.md`.

**Status: Phase 1 of 8 complete** (foundation, auth, dashboard shell, integration architecture, settings).
Phases 2–8 (Gmail intelligence, Slack, tracker + inactivity, GitHub/Calendar, assistant, workflows, hardening) are not built yet;
their nav pages say so. No integration returns mock data — with nothing connected, widgets show empty states.

## Run it locally (about 5 minutes)

Needs: Node 22+, pnpm (`npm i -g pnpm`), and Docker Desktop running (for the local Supabase stack).

```bash
pnpm install
npx supabase init          # once; creates supabase/config.toml (our migrations folder is kept)
npx supabase start         # starts local Postgres/Auth/Realtime and applies supabase/migrations
pnpm local:env             # writes .env from the running stack + fresh encryption keys
pnpm dev                   # API on :8787, web on :5173
```

Open http://localhost:5173, sign up (local Supabase doesn't require email confirmation; mails land in
Inbucket at http://localhost:54324), and you land on the dashboard. Integrations will say "Not configured"
until you add provider credentials to `.env` and restart `pnpm dev`.

To try Gmail/Calendar connect: create a Google OAuth client with redirect URIs
`http://localhost:8787/v1/oauth/callback/gmail` and `.../gcalendar`, put `GOOGLE_CLIENT_ID/SECRET` in `.env`.
(Connecting works; email sync/analysis is Phase 2.)

```bash
pnpm test                  # 40 tests, no Docker needed
```

Reset everything: `npx supabase db reset`.

## What you must provide

| Need | Where |
|---|---|
| Supabase project (URL, anon key, service-role key) | `.env`; enable Realtime for the tables the migration adds |
| `TOKEN_ENCRYPTION_KEY`, `OAUTH_STATE_KEY` | `openssl rand -base64 32` each |
| Google OAuth client (Gmail + Calendar) | redirect URIs `{API_PUBLIC_URL}/v1/oauth/callback/gmail` and `/gcalendar`. `gmail.readonly` is a restricted scope: needs Google verification for non-test users |
| Slack / GitHub / Linear OAuth apps | redirect `{API_PUBLIC_URL}/v1/oauth/callback/<provider>`; a provider without credentials shows "Not configured" |

## Not verified here
The sandbox had no Supabase instance, Docker, or provider credentials. The SQL is tested against PGlite (real Postgres engine, stubbed Supabase
auth); the OAuth endpoints/`identify()` calls follow each provider's docs but have **not** been exercised against the live services.
