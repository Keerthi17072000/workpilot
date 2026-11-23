import type { NormalizedEvent } from "./types";

/** Stable key: same real-world event -> same key, however many times it is delivered or polled. */
export function dedupeKey(provider: string, e: Pick<NormalizedEvent, "kind" | "externalId" | "discriminator">): string {
  return [provider, e.kind, e.externalId, e.discriminator ?? ""].join(":");
}
