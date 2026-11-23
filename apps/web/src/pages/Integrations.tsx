import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Plug } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Integration, Level, ProviderInfo } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: "read", label: "Read", hint: "Read information only" },
  { value: "suggest", label: "Suggest", hint: "Summaries, drafts and task suggestions — nothing is sent" },
  { value: "execute", label: "Execute", hint: "May perform actions you approve (send, create, update)" },
];

function ProviderCard({ p, conn }: { p: ProviderInfo; conn?: Integration }) {
  const qc = useQueryClient();
  const [level, setLevel] = useState<Level>(conn?.permission_level ?? "suggest");
  const [err, setErr] = useState<string | null>(null);
  const redirect = (url: string) => { window.location.href = url; };

  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/v1/integrations/connect", { method: "POST", body: JSON.stringify({ provider: p.id, level }) }),
    onSuccess: (r) => redirect(r.url), onError: (e: Error) => setErr(e.message),
  });
  const changeLevel = useMutation({
    mutationFn: (l: Level) => api<{ ok?: true; reconsent?: string }>(`/v1/integrations/${conn!.id}/level`, { method: "PATCH", body: JSON.stringify({ level: l }) }),
    onSuccess: (r, l) => { if (r.reconsent) redirect(r.reconsent); else { setLevel(l); qc.invalidateQueries({ queryKey: ["integrations"] }); } },
    onError: (e: Error) => setErr(e.message),
  });
  const disconnect = useMutation({
    mutationFn: () => api(`/v1/integrations/${conn!.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }), onError: (e: Error) => setErr(e.message),
  });

  const scopes = p.scopes[level];
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="font-semibold">{p.displayName}</h3><p className="text-sm text-muted-foreground">{p.description}</p></div>
          {conn ? (conn.status === "connected" ? <Badge tone="success">Connected</Badge> : <Badge tone="urgent">Needs reconnect</Badge>) : <Badge>Not connected</Badge>}
        </div>

        {conn && <p className="text-xs text-muted-foreground">{conn.display_name}{conn.last_synced_at ? ` · synced ${timeAgo(conn.last_synced_at)}` : " · not synced yet"}</p>}
        {conn?.last_error && <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertCircle className="h-3 w-3" />{conn.last_error}</p>}

        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor={`lvl-${p.id}`}>Access level</label>
          <NativeSelect id={`lvl-${p.id}`} value={level} disabled={changeLevel.isPending}
            onChange={(e) => { const l = e.target.value as Level; setErr(null); if (conn) changeLevel.mutate(l); else setLevel(l); }}>
            {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{LEVELS.find((l) => l.value === level)!.hint}.</p>
          <p className="break-words text-xs text-muted-foreground">Scopes requested: {scopes.length ? scopes.map((s) => s.split("/").pop()).join(", ") : "none"}</p>
        </div>

        {!p.configured && <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">Not configured on the server. Set {p.requiredEnv.map((e, i) => <span key={e}>{i > 0 && " and "}<code>{e}</code></span>)} and restart the API.</p>}
        {err && <p role="alert" className="text-xs text-destructive">{err}</p>}

        {conn
          ? <Button variant="outline" size="sm" disabled={disconnect.isPending} onClick={() => { if (confirm(`Disconnect ${p.displayName}? Stored tokens are deleted.`)) disconnect.mutate(); }}>Disconnect</Button>
          : <Button size="sm" disabled={!p.configured || connect.isPending} onClick={() => { setErr(null); connect.mutate(); }}>{connect.isPending ? "Redirecting…" : `Connect ${p.displayName}`}</Button>}
      </CardContent>
    </Card>
  );
}

export function Integrations() {
  const [params] = useSearchParams();
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api<ProviderInfo[]>("/v1/providers") });
  const conns = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("integrations").select("id,provider,status,permission_level,display_name,last_synced_at,last_error");
      if (error) throw new Error(error.message);
      return data as Integration[];
    },
  });
  const connected = params.get("connected"), error = params.get("error");

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">Connect your work apps. WorkPilot asks only for the access level you choose, and tokens never reach your browser.</p></div>
      {connected && <p role="status" className="flex items-center gap-2 rounded-lg bg-success/15 p-3 text-sm text-success"><CheckCircle2 className="h-4 w-4" />{connected} connected.</p>}
      {error && <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4" />Connection failed: {error.replace(/_/g, " ")}</p>}

      {providers.isPending || conns.isPending ? <div className="grid gap-4 md:grid-cols-2"><Card><CardContent className="pt-4"><ListSkeleton /></CardContent></Card><Card><CardContent className="pt-4"><ListSkeleton /></CardContent></Card></div>
        : providers.isError ? <Card><ErrorState message={`Can't reach the WorkPilot API (${(providers.error as Error).message}). Is it running?`} onRetry={() => providers.refetch()} /></Card>
        : conns.isError ? <Card><ErrorState message={(conns.error as Error).message} onRetry={() => conns.refetch()} /></Card>
        : <div className="grid gap-4 md:grid-cols-2">{providers.data.map((p) => <ProviderCard key={`${p.id}:${conns.data.find((c) => c.provider === p.id)?.permission_level}`} p={p} conn={conns.data.find((c) => c.provider === p.id)} />)}</div>}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Plug className="h-3 w-3" />Jira is planned after Linear.</p>
    </div>
  );
}
