import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = !!url && !!key;
// Placeholder values only keep the module loadable so <ConfigMissing/> can render; nothing calls them when unconfigured.
export const supabase = createClient(url ?? "http://localhost:54321", key ?? "unconfigured");
