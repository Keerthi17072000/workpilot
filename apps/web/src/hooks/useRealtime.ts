import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

const TABLES = ["notifications", "extracted_actions", "tasks", "reminders", "automation_executions", "messages", "integrations"];

/** Any change to a user's rows refreshes the queries that read them. RLS scopes the stream to the signed-in user. */
export function useRealtime(userId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    let ch = supabase.channel(`rt:${userId}`);
    for (const table of TABLES) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, () => qc.invalidateQueries({ queryKey: [table] }));
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);
}
