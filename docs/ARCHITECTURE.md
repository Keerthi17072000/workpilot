# WorkPilot — Architecture, Contracts, Boundaries, Roadmap

Source of truth for the schema is `supabase/migrations/`. This doc explains the *why*.

## 1. Layout

```
apps/web      React + Vite SPA. Anon key + RLS-scoped reads only. Never sees tokens.
apps/api      Hono (Node). OAuth connect/callback, disconnect, webhook intake, (later) approvals + assistant stream.
apps/jobs     Trigger.dev tasks (Phase 2+): sync, webhook processing, cron, workflow runner, action executor.
packages/core Pure TS, no I/O of its own: provider contract, registry, permission gate, crypto, webhook
              verification, dedupe keys, token refresh. Everything here is unit-tested.
supabase/     Migrations (+ RLS tests run against in-process Postgres).
```

Trust zones: browser (untrusted) → API/jobs (service role, hold tokens) → Postgres. The browser can
only do what RLS and column grants allow.

## 2. Data model (summary)

| Table | Purpose | Client access |
|---|---|---|
| `users` | profile row mirroring `auth.users` | select; update display_name/timezone |
| `integrations` | one connected account per provider; `permission_level` cap | select; update `permission_level` only |
| `oauth_tokens` | AES-256-GCM ciphertext of access/refresh tokens | **none** (RLS on, no policy, grants revoked) |
| `monitored_events` | raw event ledger; `unique(integration_id, dedupe_key)` is the duplicate guard | select |
| `messages` | normalized metadata + ≤500-char snippet + AI analysis; body stays in the source app | select |
| `extracted_actions` | AI suggestions (task/follow-up/draft…); approval state machine | select (approve via API) |
| `tasks` | tracker items we monitor (status, due, last activity) | select |
| `reminders` | scheduled/snoozed/suppressed reminders; `unique(user_id, dedupe_key)` | select |
| `automation_workflows` | trigger → conditions → ai → actions → notify, as validated JSON | full CRUD (own rows) |
| `automation_executions` | run history; `unique(workflow_id, idempotency_key)` | select |
| `notifications` | unified activity center; `unique(user_id, dedupe_key)` | select; update read/dismissed |
| `activity_logs` | append-only audit (who/what/level/outcome) | select |
| `daily_summaries` | briefings & reports with the source counts they were built from | select |
| `user_preferences` | thresholds, quiet hours, approval policy, theme | select/update |

Design rules: every row has `user_id` (RLS: `user_id = auth.uid()`); external data is referenced by
`(integration_id, external_id)` and not mirrored beyond what analysis needs; tokens never leave the
server zone; audit rows can't be updated or deleted by clients.

## 3. Integration contract (`packages/core/src/integrations`)

```ts
interface IntegrationModule {
  id: ProviderId;
  displayName: string;
  oauth: { authUrl; tokenUrl; scopes: { read; suggest; execute }; pkce; clientIdEnv; clientSecretEnv };
  identify(accessToken): Promise<{ externalAccountId; displayName }>;   // after OAuth
  sync?(ctx, cursor): Promise<{ events: NormalizedEvent[]; cursor }>;   // delta polling (jobs)
  webhook?: { verify(headers, rawBody): boolean; parse(rawBody, headers): WebhookResult };
  actions?: Record<string, ActionDefinition>;                           // EXECUTE-level operations
  revoke?(tokens): Promise<void>;                                       // best effort on disconnect
}
```

Scopes are tiered: connecting at `read` requests only `scopes.read`; raising the level re-consents
with the union. Minimum scopes by construction.

## 4. Permission model

`READ < SUGGEST < EXECUTE`. `authorize()` is the single gate: an action needs
`integration.permission_level ≥ action.level`, and EXECUTE additionally needs an approved
`extracted_action` unless the user has switched the approval policy off for that action kind.
Every decision (allow or deny) writes `activity_logs`.

## 5. AI agent boundaries (Phase 2+)

- LLM access only through an `LlmProvider` interface (Anthropic / OpenAI / Ollama adapters); structured
  output validated with zod; one retry on schema failure, then the item is marked `analysis_failed`.
- Tools are typed, level-tagged and go through `authorize()`. The model can *call* SUGGEST tools freely;
  EXECUTE tools only create a pending `extracted_action` — the model never executes directly.
- Untrusted content (emails, Slack, docs, transcripts) is wrapped in delimited data blocks, the system
  prompt states it is data, and tool arguments derived from it are validated server-side. Content can
  never raise its own permission level or alter policy.
- Reports/briefings are assembled from rows in our DB and counts are stored; no data → section omitted,
  never invented.

## 6. Reliability

Webhooks: verify signature → insert event (`ON CONFLICT DO NOTHING`) → return 200. Processing happens in
durable jobs with retries; idempotency keys on events, notifications, reminders and executions make
every step safe to repeat. No automation depends on a browser timer.

## 7. Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation, auth, dashboard shell, integration architecture, settings, schema + RLS, OAuth plumbing | built |
| 2 | Gmail: sync, importance classification, summaries, reply drafts, LLM abstraction | next |
| 3 | Slack mentions + action extraction; unified activity center | |
| 4 | Linear tracker, task monitor, inactivity monitor, follow-up agent, approvals endpoint | |
| 5 | GitHub, Calendar, meeting intelligence | |
| 6 | Assistant chat + embeddings (pgvector migration) | |
| 7 | Workflow builder/runner, reports | |
| 8 | Hardening, load/security review, deploy | |

Deferred on purpose: Jira (Linear first; Jira needs cloud-id resolution), embeddings (Phase 6), Trigger.dev
tasks (Phase 2, when there is something to run).
