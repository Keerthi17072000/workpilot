import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";
import type { Prefs } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { useTheme } from "@/stores/theme";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="grid gap-1.5 sm:grid-cols-[14rem_1fr] sm:items-start">
    <div><Label>{label}</Label>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div><div>{children}</div>
  </div>
);

function PrefsForm({ initial, timezone }: { initial: Prefs; timezone: string }) {
  const qc = useQueryClient();
  const [p, setP] = useState(initial);
  const [tz, setTz] = useState(timezone);
  const { theme, setTheme } = useTheme();
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(p) !== JSON.stringify(initial) || tz !== timezone;

  const save = useMutation({
    mutationFn: async () => {
      const r1 = await supabase.from("user_preferences").update({
        ...p, quiet_hours_start: p.quiet_hours_start || null, quiet_hours_end: p.quiet_hours_end || null,
      }).eq("user_id", (await supabase.auth.getUser()).data.user!.id);
      if (r1.error) throw new Error(r1.error.message);
      const r2 = await supabase.from("users").update({ timezone: tz }).eq("id", (await supabase.auth.getUser()).data.user!.id);
      if (r2.error) throw new Error(r2.error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user_preferences"] }),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Automation preferences</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <Field label="Require approval for actions" hint="Sending emails, creating or updating tracker items always ask first when on.">
          <Switch aria-label="Require approval" checked={p.require_approval} onCheckedChange={(v) => set("require_approval", v)} />
          {!p.require_approval && <p className="mt-1.5 text-xs text-destructive">Approved-action safety is off: allowed actions will run without asking.</p>}
        </Field>
        <Field label="Tracker inactivity threshold" hint="Minutes without a tracker update before a reminder. Based on tracker activity only — not your computer.">
          <Input type="number" min={5} max={1440} className="w-28" value={p.inactivity_threshold_minutes}
            onChange={(e) => set("inactivity_threshold_minutes", Number(e.target.value))} />
        </Field>
        <Field label="Quiet hours" hint={`No reminders in this window (${tz}).`}>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="time" className="w-32" aria-label="Quiet hours start" value={hhmm(p.quiet_hours_start)} onChange={(e) => set("quiet_hours_start", e.target.value || null)} />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="time" className="w-32" aria-label="Quiet hours end" value={hhmm(p.quiet_hours_end)} onChange={(e) => set("quiet_hours_end", e.target.value || null)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quiet all day on">
            {DAYS.map((d, i) => {
              const on = p.quiet_days.includes(i);
              return <button key={d} type="button" aria-pressed={on} onClick={() => set("quiet_days", on ? p.quiet_days.filter((x) => x !== i) : [...p.quiet_days, i].sort())}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${on ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"}`}>{d}</button>;
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Highlighted days are quiet all day.</p>
        </Field>
        <Field label="Suppress during meetings" hint="Hold reminders while a calendar event is in progress.">
          <Switch aria-label="Suppress during meetings" checked={p.suppress_during_meetings} onCheckedChange={(v) => set("suppress_during_meetings", v)} />
        </Field>
        <Field label="Daily briefing time"><Input type="time" className="w-32" value={hhmm(p.briefing_time)} onChange={(e) => set("briefing_time", e.target.value)} /></Field>
        <Field label="Weekly report day">
          <NativeSelect className="w-40" value={p.weekly_report_day} onChange={(e) => set("weekly_report_day", Number(e.target.value))}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Timezone"><Input className="w-64" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="e.g. Asia/Kolkata" /></Field>
        <Field label="AI provider" hint="Which model family analyses your content.">
          <NativeSelect className="w-48" value={p.llm_provider} onChange={(e) => set("llm_provider", e.target.value as Prefs["llm_provider"])}>
            <option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="ollama">Ollama (local)</option>
          </NativeSelect>
        </Field>
        <Field label="Theme">
          <NativeSelect className="w-40" value={theme} onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}>
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </NativeSelect>
        </Field>
        <div className="flex items-center gap-3 border-t pt-4">
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</Button>
          {save.isSuccess && !dirty && <span role="status" className="text-sm text-success">Saved</span>}
          {save.isError && <span role="alert" className="text-sm text-destructive">{(save.error as Error).message}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function AuditLog() {
  const q = useQuery({
    queryKey: ["activity_logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("activity_logs").select("id,actor,action,level,outcome,detail,created_at").order("created_at", { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return data as { id: string; actor: string; action: string; level: string | null; outcome: string; detail: Record<string, unknown>; created_at: string }[];
    },
  });
  return (
    <Card>
      <CardHeader><CardTitle>Audit history</CardTitle></CardHeader>
      <CardContent>
        {q.isPending ? <ListSkeleton rows={4} /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
          : q.data.length === 0 ? <EmptyState icon={ScrollText} title="No activity yet" hint="Connections, permission changes and approved actions are recorded here." />
          : <ul className="divide-y">{q.data.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">{l.action}{typeof l.detail.provider === "string" ? ` · ${l.detail.provider}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{l.actor}{l.level ? ` · ${l.level}` : ""} · {timeAgo(l.created_at)}</p></div>
                <Badge tone={l.outcome === "success" ? "success" : l.outcome === "denied" ? "important" : "urgent"}>{l.outcome}</Badge>
              </li>))}</ul>}
      </CardContent>
    </Card>
  );
}

export function Settings() {
  const q = useQuery({
    queryKey: ["user_preferences", "all"],
    queryFn: async () => {
      const [p, u] = await Promise.all([supabase.from("user_preferences").select("*").single(), supabase.from("users").select("timezone").single()]);
      if (p.error) throw new Error(p.error.message);
      if (u.error) throw new Error(u.error.message);
      return { prefs: p.data as Prefs, timezone: u.data.timezone as string };
    },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {q.isPending ? <Card><CardContent className="pt-4"><ListSkeleton rows={6} /></CardContent></Card>
        : q.isError ? <Card><ErrorState message={q.error.message} onRetry={() => q.refetch()} /></Card>
        : <PrefsForm key={q.dataUpdatedAt} initial={q.data.prefs} timezone={q.data.timezone} />}
      <AuditLog />
    </div>
  );
}
