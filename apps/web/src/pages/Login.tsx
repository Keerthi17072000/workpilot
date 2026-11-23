import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/lib/supabase";

export function Login() {
  const { session, loading } = useSession();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!loading && session) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { data, error } = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else if (mode === "up" && !data.session) setMsg({ ok: true, text: "Check your inbox to confirm your email, then sign in." });
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-5 pt-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight"><span className="text-primary">Work</span>Pilot</h1>
            <p className="mt-1 text-sm text-muted-foreground">{mode === "in" ? "Sign in to your workspace" : "Create your account"}</p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            {msg && <p role="alert" className={msg.ok ? "text-sm text-success" : "text-sm text-destructive"}>{msg.text}</p>}
            <Button className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}</Button>
          </form>
          <button type="button" className="w-full cursor-pointer text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>
            {mode === "in" ? "No account? Sign up" : "Have an account? Sign in"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
