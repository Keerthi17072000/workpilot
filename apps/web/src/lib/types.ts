export type Level = "read" | "suggest" | "execute";
export type Category = "urgent" | "important" | "requires_response" | "requires_action" | "informational";

export interface ProviderInfo {
  id: string; displayName: string; description: string; configured: boolean; requiredEnv: string[];
  scopes: Record<Level, string[]>;
}
export interface Integration {
  id: string; provider: string; status: "connected" | "error" | "revoked"; permission_level: Level;
  display_name: string | null; last_synced_at: string | null; last_error: string | null;
}
export interface Prefs {
  inactivity_threshold_minutes: number; quiet_hours_start: string | null; quiet_hours_end: string | null;
  quiet_days: number[]; suppress_during_meetings: boolean; briefing_time: string; weekly_report_day: number;
  require_approval: boolean; llm_provider: "anthropic" | "openai" | "ollama";
}
