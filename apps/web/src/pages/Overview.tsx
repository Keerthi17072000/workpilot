import { useQuery } from "@tanstack/react-query";
import { Activity, AlarmClock, CalendarClock, CheckSquare, GitPullRequest, Hash, ListChecks, Mail, Sparkles, Workflow, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";

/** Runs one Supabase query (RLS scopes it to the user). queryKey[0] is the table so realtime can invalidate it. */
function useRows<T>(table: string, key: string, run: (q: any) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  return useQuery({
    queryKey: [table, "widget", key],
    queryFn: async () => { const { data, error } = await run(supabase.from(table)); if (error) throw new Error(error.message); return (data ?? []) as T[]; },
  });
}

function Widget<T>({ title, icon: Icon, q, empty, children, className }: {
  title: string; icon: LucideIcon; q: ReturnType<typeof useRows<T>>; empty: { title: string; hint: string; action?: ReactNode };
  children: (rows: T[]) => ReactNode; className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" aria-hidden />{title}</CardTitle></CardHeader>
      <CardContent>
        {q.isPending ? <ListSkeleton />
          : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
          : q.data.length === 0 ? <EmptyState icon={Icon} {...empty} />
          : <ul className="divide-y">{children(q.data)}</ul>}
      </CardContent>
    </Card>
  );
}

const Row = ({ title, meta, badge }: { title: string; meta?: string; badge?: ReactNode }) => (
  <li className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
    <div className="min-w-0"><p className="truncate text-sm font-medium">{title}</p>{meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}</div>
    {badge}
  </li>
);
const connect = (label: string) => <Button asChild size="sm" variant="outline"><Link to="/integrations">{label}</Link></Button>;
const tone = (c: string) => (c === "urgent" ? "urgent" : c === "important" ? "important" : "neutral") as "urgent" | "important" | "neutral";

interface Msg { id: string; sender: string | null; subject: string | null; snippet: string | null; received_at: string; category: string | null }
interface Notif { id: string; title: string; body: string | null; category: string; created_at: string }
interface TaskRow { id: string; title: string; status: string; status_category: string; due_at: string | null; last_external_update_at: string | null }
interface Rem { id: string; fire_at: string; payload: { title?: string } }
interface Exec { id: string; status: string; created_at: string; automation_workflows: { name: string } | null }
interface Meeting { id: string; occurred_at: string; payload: { title?: string } }

export function Overview() {
  const priorities = useRows<Notif>("notifications", "priorities", (q) =>
    q.select("id,title,body,category,created_at").in("category", ["urgent", "important"]).is("dismissed_at", null).order("created_at", { ascending: false }).limit(5));
  const emails = useRows<Msg>("messages", "emails", (q) =>
    q.select("id,sender,subject,snippet,received_at,category").eq("kind", "email").in("category", ["urgent", "important", "requires_response"]).order("received_at", { ascending: false }).limit(5));
  const slack = useRows<Msg>("messages", "slack", (q) =>
    q.select("id,sender,subject,snippet,received_at,category").eq("kind", "slack_message").eq("is_read", false).order("received_at", { ascending: false }).limit(5));
  const tasks = useRows<TaskRow>("tasks", "pending", (q) =>
    q.select("id,title,status,status_category,due_at,last_external_update_at").in("status_category", ["todo", "in_progress", "blocked"]).order("due_at", { ascending: true, nullsFirst: false }).limit(5));
  const prs = useRows<Msg>("messages", "prs", (q) =>
    q.select("id,sender,subject,snippet,received_at,category").eq("kind", "pull_request").eq("needs_response", true).order("received_at", { ascending: false }).limit(5));
  // Meetings are stored as monitored_events(kind='calendar.meeting') with occurred_at = start time.
  const meetings = useRows<Meeting>("monitored_events", "meetings", (q) =>
    q.select("id,occurred_at,payload").eq("kind", "calendar.meeting").gte("occurred_at", new Date().toISOString()).order("occurred_at").limit(5));
  const followups = useRows<Rem>("reminders", "followups", (q) =>
    q.select("id,fire_at,payload").eq("kind", "follow_up").in("status", ["scheduled", "snoozed"]).order("fire_at").limit(5));
  const runs = useRows<Exec>("automation_executions", "recent", (q) =>
    q.select("id,status,created_at,automation_workflows(name)").order("created_at", { ascending: false }).limit(5));
  const lastTask = useRows<TaskRow>("tasks", "last-activity", (q) =>
    q.select("id,title,status,status_category,due_at,last_external_update_at").not("last_external_update_at", "is", null).order("last_external_update_at", { ascending: false }).limit(1));
  const prefs = useQuery({
    queryKey: ["user_preferences", "threshold"],
    queryFn: async () => { const { data, error } = await supabase.from("user_preferences").select("inactivity_threshold_minutes").single(); if (error) throw new Error(error.message); return data.inactivity_threshold_minutes as number; },
  });

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">What needs your attention, across everything you've connected.</p></div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Widget className="lg:col-span-2" title="Today's priorities" icon={Sparkles} q={priorities}
          empty={{ title: "Nothing urgent", hint: "Urgent and important items from your connected apps will appear here.", action: connect("Connect an app") }}>
          {(rows) => rows.map((n) => <Row key={n.id} title={n.title} meta={n.body ?? timeAgo(n.created_at)} badge={<Badge tone={tone(n.category)}>{n.category.replace("_", " ")}</Badge>} />)}
        </Widget>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-muted-foreground" aria-hidden />Tracker inactivity</CardTitle></CardHeader>
          <CardContent>
            {lastTask.isPending || prefs.isPending ? <ListSkeleton rows={2} />
              : lastTask.isError || prefs.isError ? <ErrorState message={((lastTask.error ?? prefs.error) as Error).message} onRetry={() => { lastTask.refetch(); prefs.refetch(); }} />
              : !lastTask.data[0] ? <EmptyState icon={Activity} title="No tracker activity yet" hint={`Connect a tracker and we'll nudge you after ${prefs.data} minutes without an update.`} action={connect("Connect tracker")} />
              : (<div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Last updated task</p>
                  <p className="text-sm font-medium">{lastTask.data[0].title}</p>
                  <p className="text-xs text-muted-foreground">Updated {timeAgo(lastTask.data[0].last_external_update_at!)} · reminder threshold {prefs.data} min</p>
                  <p className="text-xs text-muted-foreground">Based on tracker updates only — not your computer activity.</p>
                </div>)}
          </CardContent>
        </Card>

        <Widget title="Important emails" icon={Mail} q={emails} empty={{ title: "No important emails", hint: "Connect Gmail to see emails that need you.", action: connect("Connect Gmail") }}>
          {(rows) => rows.map((m) => <Row key={m.id} title={m.subject ?? "(no subject)"} meta={`${m.sender ?? "Unknown"} · ${timeAgo(m.received_at)}`} badge={m.category && <Badge tone={tone(m.category)}>{m.category.replace("_", " ")}</Badge>} />)}
        </Widget>
        <Widget title="Slack mentions" icon={Hash} q={slack} empty={{ title: "No unread mentions", hint: "Connect Slack to track mentions and requests.", action: connect("Connect Slack") }}>
          {(rows) => rows.map((m) => <Row key={m.id} title={m.snippet ?? m.subject ?? "Message"} meta={`${m.sender ?? "Unknown"} · ${timeAgo(m.received_at)}`} />)}
        </Widget>
        <Widget title="Pending tracker tasks" icon={ListChecks} q={tasks} empty={{ title: "No open tasks", hint: "Assigned tracker tasks show up here.", action: connect("Connect tracker") }}>
          {(rows) => rows.map((t) => <Row key={t.id} title={t.title} meta={t.due_at ? `Due ${new Date(t.due_at).toLocaleDateString()}` : t.status} badge={t.status_category === "blocked" ? <Badge tone="urgent">blocked</Badge> : undefined} />)}
        </Widget>

        <Widget title="GitHub review requests" icon={GitPullRequest} q={prs} empty={{ title: "No reviews waiting", hint: "Connect GitHub to see PRs waiting on you.", action: connect("Connect GitHub") }}>
          {(rows) => rows.map((m) => <Row key={m.id} title={m.subject ?? "Pull request"} meta={`${m.sender ?? ""} · ${timeAgo(m.received_at)}`} />)}
        </Widget>
        <Widget title="Upcoming meetings" icon={CalendarClock} q={meetings} empty={{ title: "No upcoming meetings", hint: "Connect Google Calendar for briefs and reminders.", action: connect("Connect Calendar") }}>
          {(rows) => rows.map((m) => <Row key={m.id} title={m.payload.title ?? "Meeting"} meta={new Date(m.occurred_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} />)}
        </Widget>
        <Widget title="Follow-up reminders" icon={AlarmClock} q={followups} empty={{ title: "No follow-ups pending", hint: "Unanswered emails and threads will be flagged here." }}>
          {(rows) => rows.map((r) => <Row key={r.id} title={r.payload.title ?? "Follow up"} meta={`Due ${new Date(r.fire_at).toLocaleString()}`} />)}
        </Widget>

        <Widget className="lg:col-span-3" title="Recent automation activity" icon={Workflow} q={runs} empty={{ title: "No automation runs yet", hint: "Workflow runs and their results will be listed here.", action: <Button asChild size="sm" variant="outline"><Link to="/automations">Automations</Link></Button> }}>
          {(rows) => rows.map((r) => <Row key={r.id} title={r.automation_workflows?.name ?? "Workflow"} meta={timeAgo(r.created_at)} badge={<Badge tone={r.status === "succeeded" ? "success" : r.status === "failed" ? "urgent" : "neutral"}>{r.status.replace("_", " ")}</Badge>} />)}
        </Widget>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckSquare className="h-3 w-3" aria-hidden />Live: this page updates as new events arrive.</p>
    </div>
  );
}
