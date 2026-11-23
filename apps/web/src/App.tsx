import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionProvider, useSession } from "@/hooks/useSession";
import { supabaseConfigured } from "@/lib/supabase";
import { ComingSoon } from "@/pages/ComingSoon";
import { Integrations } from "@/pages/Integrations";
import { Login } from "@/pages/Login";
import { Overview } from "@/pages/Overview";
import { Settings } from "@/pages/Settings";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true } } });

function RequireAuth() {
  const { session, loading } = useSession();
  if (loading) return <div className="p-8"><Skeleton className="h-8 w-48" /></div>;
  return session ? <AppShell /> : <Navigate to="/login" replace />;
}

const soon = (title: string, phase: number, blurb: string) => <ComingSoon title={title} phase={phase} blurb={blurb} />;

export function App() {
  if (!supabaseConfigured) {
    return <div className="grid min-h-screen place-items-center p-6 text-center"><div className="max-w-md space-y-2">
      <h1 className="text-lg font-semibold">WorkPilot isn't configured</h1>
      <p className="text-sm text-muted-foreground">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code> (see <code>.env.example</code>) and restart the dev server.</p>
    </div></div>;
  }
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth />}>
              <Route index element={<Overview />} />
              <Route path="assistant" element={soon("AI Assistant", 6, "Ask what to work on, which emails need replies, or what's waiting on others — answered from your connected apps.")} />
              <Route path="inbox" element={soon("Unified Inbox", 3, "Email, Slack and tracker notifications in one place, de-duplicated and ranked.")} />
              <Route path="tasks" element={soon("Tasks & Actions", 4, "Tracked tasks and AI-suggested actions awaiting your approval.")} />
              <Route path="automations" element={soon("Automations", 7, "Build trigger → conditions → AI → action workflows and review their run history.")} />
              <Route path="activity" element={soon("Activity Monitor", 4, "Tracker inactivity, follow-ups and missed deadlines.")} />
              <Route path="meetings" element={soon("Meeting Intelligence", 5, "Pre-meeting briefs and post-meeting action items.")} />
              <Route path="reports" element={soon("Reports", 7, "Daily and weekly summaries built only from verified activity.")} />
              <Route path="integrations" element={<Integrations />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  );
}
