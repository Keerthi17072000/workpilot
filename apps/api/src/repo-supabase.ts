import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt, type KeyRing, type TokenSet } from "@workpilot/core";
import type { Repo } from "./repo";

const fail = (op: string, error: { message: string } | null) => { if (error) throw new Error(`${op}: ${error.message}`); };

export function supabaseRepo(db: SupabaseClient, ring: KeyRing): Repo {
  return {
    tokens: {
      async get(id) {
        const { data, error } = await db.from("oauth_tokens").select("*").eq("integration_id", id).maybeSingle();
        fail("tokens.get", error);
        if (!data) return null;
        return {
          accessToken: decrypt(ring, data.access_token_enc),
          refreshToken: data.refresh_token_enc ? decrypt(ring, data.refresh_token_enc) : undefined,
          expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
        } satisfies TokenSet;
      },
      async save(id, t) {
        const { data: row, error: e1 } = await db.from("integrations").select("user_id").eq("id", id).single();
        fail("tokens.save/lookup", e1);
        const { error } = await db.from("oauth_tokens").upsert({
          integration_id: id, user_id: row!.user_id,
          access_token_enc: encrypt(ring, t.accessToken),
          refresh_token_enc: t.refreshToken ? encrypt(ring, t.refreshToken) : null,
          expires_at: t.expiresAt?.toISOString() ?? null,
        });
        fail("tokens.save", error);
      },
      async markReauthRequired(id, reason) {
        const { error } = await db.from("integrations").update({ status: "error", last_error: `reauth required: ${reason}` }).eq("id", id);
        fail("markReauthRequired", error);
      },
    },
    async upsertIntegration(i) {
      const { data, error } = await db.from("integrations").upsert({
        user_id: i.userId, provider: i.provider, external_account_id: i.externalAccountId, display_name: i.displayName,
        permission_level: i.level, granted_scopes: i.scopes, status: "connected", last_error: null,
      }, { onConflict: "user_id,provider,external_account_id" }).select("id").single();
      fail("upsertIntegration", error);
      return data!.id;
    },
    async getIntegration(userId, id) {
      const { data, error } = await db.from("integrations").select("id,user_id,provider,permission_level,granted_scopes")
        .eq("id", id).eq("user_id", userId).maybeSingle();
      fail("getIntegration", error);
      return data;
    },
    async setLevel(id, level) {
      const { error } = await db.from("integrations").update({ permission_level: level }).eq("id", id);
      fail("setLevel", error);
    },
    async deleteIntegration(id) {
      const { error } = await db.from("integrations").delete().eq("id", id);
      fail("deleteIntegration", error);
    },
    async audit(e) {
      const { error } = await db.from("activity_logs").insert({
        user_id: e.userId, actor: e.actor, action: e.action, outcome: e.outcome, level: e.level ?? null,
        integration_id: e.integrationId ?? null, detail: e.detail ?? {},
      });
      fail("audit", error);
    },
  };
}
