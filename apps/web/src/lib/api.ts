import { supabase } from "./supabase";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(public status: number, public body: any) { super(body?.error ?? `HTTP ${status}`); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(API_URL + path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}`, ...init.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
