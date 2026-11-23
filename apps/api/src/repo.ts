import type { PermissionLevel, TokenStore } from "@workpilot/core";

export interface IntegrationRow {
  id: string; user_id: string; provider: string; permission_level: PermissionLevel; granted_scopes: string[];
}
export interface AuditEntry {
  userId: string; actor: "user" | "system" | "agent"; action: string; outcome: "success" | "denied" | "error";
  level?: PermissionLevel; integrationId?: string; detail?: Record<string, unknown>;
}

/** Everything the API needs from storage. Implemented over Supabase; tests use an in-memory version. */
export interface Repo {
  tokens: TokenStore;
  upsertIntegration(i: { userId: string; provider: string; externalAccountId: string; displayName: string; level: PermissionLevel; scopes: string[] }): Promise<string>;
  getIntegration(userId: string, id: string): Promise<IntegrationRow | null>;
  setLevel(id: string, level: PermissionLevel): Promise<void>;
  deleteIntegration(id: string): Promise<void>;
  audit(e: AuditEntry): Promise<void>;
}
