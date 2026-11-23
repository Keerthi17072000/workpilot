import { Activity, BarChart3, CalendarClock, Inbox, LayoutDashboard, ListChecks, LogOut, Menu, Moon, Plug, Settings, Sparkles, Sun, Workflow, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useRealtime } from "@/hooks/useRealtime";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useTheme } from "@/stores/theme";
import { Button } from "./ui/button";

export const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/assistant", label: "AI Assistant", icon: Sparkles },
  { to: "/inbox", label: "Unified Inbox", icon: Inbox },
  { to: "/tasks", label: "Tasks & Actions", icon: ListChecks },
  { to: "/automations", label: "Automations", icon: Workflow },
  { to: "/activity", label: "Activity Monitor", icon: Activity },
  { to: "/meetings", label: "Meeting Intelligence", icon: CalendarClock },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell() {
  const { session } = useSession();
  useRealtime(session!.user.id);
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const isDark = document.documentElement.classList.contains("dark");

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-60 border-r bg-card p-3 transition-transform md:static md:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="mb-4 flex items-center justify-between px-2 pt-1">
          <span className="text-lg font-semibold tracking-tight"><span className="text-primary">Work</span>Pilot</span>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
        </div>
        <nav aria-label="Main" className="space-y-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={() => setOpen(false)}
              className={({ isActive }) => cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors", isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </NavLink>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur md:px-8">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="h-4 w-4" /></Button>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-2 hidden text-xs text-muted-foreground sm:inline">{session!.user.email}</span>
            <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(isDark ? "light" : "dark")} data-theme={theme}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4" /></Button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
