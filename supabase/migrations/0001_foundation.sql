-- WorkPilot foundation schema. Every table is user-scoped and RLS-protected.
-- Clients (anon/authenticated) get ONLY the grants listed at the bottom; the service role
-- (API + jobs) bypasses RLS and is the only principal that can touch oauth_tokens.

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ───────────── users (profile) ─────────────
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── user_preferences ─────────────
create table public.user_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  inactivity_threshold_minutes int not null default 90 check (inactivity_threshold_minutes between 5 and 1440),
  quiet_hours_start time,                      -- local to users.timezone; null = no quiet hours
  quiet_hours_end time,
  quiet_days smallint[] not null default '{0,6}', -- 0=Sun..6=Sat: days quiet hours apply all day
  suppress_during_meetings boolean not null default true,
  briefing_time time not null default '09:00',
  weekly_report_day smallint not null default 5 check (weekly_report_day between 0 and 6),
  require_approval boolean not null default true, -- EXECUTE actions need explicit approval
  llm_provider text not null default 'anthropic' check (llm_provider in ('anthropic','openai','ollama')),
  theme text not null default 'system' check (theme in ('light','dark','system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── integrations / oauth_tokens ─────────────
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('gmail','gcalendar','slack','github','linear','jira')),
  status text not null default 'connected' check (status in ('connected','error','revoked')),
  permission_level text not null default 'suggest' check (permission_level in ('read','suggest','execute')),
  granted_scopes text[] not null default '{}',
  external_account_id text not null,
  display_name text,
  sync_cursor jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_account_id)
);
create index integrations_user_idx on public.integrations (user_id);

create table public.oauth_tokens (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  access_token_enc text not null,   -- AES-256-GCM, format "v<keyver>.<iv>.<tag>.<ct>" (see core/crypto)
  refresh_token_enc text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ───────────── monitored_events (ledger + duplicate guard) ─────────────
create table public.monitored_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  provider text not null,
  kind text not null,                -- e.g. email.received, slack.mention, pr.review_requested
  external_id text not null,
  dedupe_key text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}',  -- minimal metadata only
  status text not null default 'pending' check (status in ('pending','processing','processed','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (integration_id, dedupe_key)
);
create index monitored_events_user_time_idx on public.monitored_events (user_id, occurred_at desc);
create index monitored_events_pending_idx on public.monitored_events (created_at) where status in ('pending','failed');

-- ───────────── messages (normalized; body stays in the source app) ─────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  event_id uuid references public.monitored_events(id) on delete set null,
  kind text not null check (kind in ('email','slack_message','pull_request','issue','meeting_note')),
  external_id text not null,
  thread_id text,
  sender text,
  subject text,
  snippet text check (char_length(snippet) <= 500),
  url text,
  received_at timestamptz not null,
  is_read boolean not null default false,
  category text check (category in ('urgent','important','requires_response','requires_action','informational')),
  needs_response boolean not null default false,
  responded_at timestamptz,
  summary text,
  analysis jsonb,                    -- structured AI output (validated before write)
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, kind, external_id)
);
create index messages_user_received_idx on public.messages (user_id, received_at desc);
create index messages_open_response_idx on public.messages (user_id, received_at)
  where needs_response and responded_at is null;
create index messages_thread_idx on public.messages (integration_id, thread_id);

-- ───────────── tasks (tracker items we monitor) ─────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  external_id text not null,
  title text not null,
  status text not null,
  status_category text not null default 'todo' check (status_category in ('todo','in_progress','blocked','done','cancelled')),
  due_at timestamptz,
  assignee text,
  url text,
  last_external_update_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, external_id)
);
create index tasks_user_open_idx on public.tasks (user_id, due_at) where status_category in ('todo','in_progress','blocked');

-- ───────────── extracted_actions (AI suggestions + approval state machine) ─────────────
create table public.extracted_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_message_id uuid references public.messages(id) on delete set null,
  kind text not null check (kind in ('task','follow_up','reply_draft','decision','commitment','deadline')),
  title text not null,
  description text,
  assignee_hint text,
  due_at timestamptz,
  confidence numeric(3,2) check (confidence between 0 and 1),
  proposed_action jsonb,             -- {tool, args}; validated server-side before execution
  required_level text not null default 'suggest' check (required_level in ('read','suggest','execute')),
  status text not null default 'suggested'
    check (status in ('suggested','approved','rejected','executed','failed','expired')),
  approved_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  error text,
  task_id uuid references public.tasks(id) on delete set null, -- tracked until completion
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index extracted_actions_user_status_idx on public.extracted_actions (user_id, status, created_at desc);

-- ───────────── reminders ─────────────
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('inactivity','meeting','follow_up','deadline','custom')),
  subject_type text,
  subject_id uuid,
  dedupe_key text not null,
  fire_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','sent','snoozed','cancelled','suppressed')),
  snoozed_until timestamptz,
  suppressed_reason text check (suppressed_reason in ('quiet_hours','in_meeting')),
  payload jsonb not null default '{}',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index reminders_due_idx on public.reminders (fire_at) where status in ('scheduled','snoozed');

-- ───────────── automation_workflows / automation_executions ─────────────
create table public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  enabled boolean not null default true,
  template_key text,
  trigger jsonb not null,            -- {type:'event'|'schedule'|'inactivity'|'before_meeting', config:{...}}
  conditions jsonb not null default '[]',
  ai_step jsonb,                     -- {task:'summarize'|'extract_actions'|..., options}
  actions jsonb not null default '[]',
  notify jsonb not null default '{}',
  cron text,                         -- for schedule triggers
  timezone text not null default 'UTC',
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workflows_user_idx on public.automation_workflows (user_id);
create index workflows_due_idx on public.automation_workflows (next_run_at) where enabled and cron is not null;

create table public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  trigger_event_id uuid references public.monitored_events(id) on delete set null,
  idempotency_key text not null,
  status text not null default 'queued'
    check (status in ('queued','running','awaiting_approval','succeeded','failed','skipped')),
  steps jsonb not null default '[]',
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workflow_id, idempotency_key)
);
create index executions_user_idx on public.automation_executions (user_id, created_at desc);

-- ───────────── notifications (unified activity center) ─────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  dedupe_key text not null,
  category text not null check (category in ('urgent','important','requires_response','requires_action','informational')),
  title text not null,
  body text,
  provider text,
  source_ref jsonb,
  url text,
  actions jsonb not null default '[]', -- e.g. resume_task / update_progress / snooze
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_feed_idx on public.notifications (user_id, created_at desc) where dismissed_at is null;

-- ───────────── activity_logs (append-only audit) ─────────────
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  actor text not null check (actor in ('user','system','agent')),
  action text not null,
  level text check (level in ('read','suggest','execute')),
  integration_id uuid references public.integrations(id) on delete set null,
  outcome text not null check (outcome in ('success','denied','error')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_logs_user_idx on public.activity_logs (user_id, created_at desc);

-- ───────────── daily_summaries ─────────────
create table public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('briefing','daily_report','weekly_report')),
  period_start date not null,
  period_end date not null,
  content jsonb not null,
  source_counts jsonb not null default '{}', -- what the report was built from; never fabricate beyond this
  model text,
  generated_at timestamptz not null default now(),
  unique (user_id, kind, period_start)
);

-- ───────────── triggers ─────────────
do $$ declare t text; begin
  foreach t in array array['users','user_preferences','integrations','oauth_tokens','messages','tasks',
    'extracted_actions','reminders','automation_workflows'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  insert into public.user_preferences (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── Row Level Security ─────────────
do $$ declare t text; begin
  foreach t in array array['users','user_preferences','integrations','oauth_tokens','monitored_events','messages',
    'tasks','extracted_actions','reminders','automation_workflows','automation_executions','notifications',
    'activity_logs','daily_summaries'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- oauth_tokens: RLS on, deliberately NO policy, no grants -> invisible to every client role.
create policy own_row on public.users for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy own_rows on public.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$ declare t text; begin
  foreach t in array array['integrations','monitored_events','messages','tasks','extracted_actions','reminders',
    'automation_workflows','automation_executions','notifications','activity_logs','daily_summaries'] loop
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
-- (RLS policies above are "for all"; what a client can actually do is bounded by the grants below.)

-- ───────────── Grants: least privilege ─────────────
revoke all on all tables in schema public from anon, authenticated;

grant select on public.users, public.user_preferences, public.integrations, public.monitored_events,
  public.messages, public.tasks, public.extracted_actions, public.reminders, public.automation_executions,
  public.notifications, public.activity_logs, public.daily_summaries, public.automation_workflows
  to authenticated;

grant update (display_name, timezone) on public.users to authenticated;
grant update (inactivity_threshold_minutes, quiet_hours_start, quiet_hours_end, quiet_days,
  suppress_during_meetings, briefing_time, weekly_report_day, require_approval, llm_provider, theme)
  on public.user_preferences to authenticated;
-- integrations are write-protected for clients: level changes go through the API (re-consent + audit).
grant update (read_at, dismissed_at) on public.notifications to authenticated;
grant insert, delete on public.automation_workflows to authenticated;
grant update (name, description, enabled, trigger, conditions, ai_step, actions, notify, cron, timezone)
  on public.automation_workflows to authenticated;

grant all on all tables in schema public to service_role;

-- ───────────── Realtime (only where the publication exists, i.e. Supabase) ─────────────
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.extracted_actions,
      public.tasks, public.automation_executions, public.reminders;
  end if;
end $$;
