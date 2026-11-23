export const PERMISSION_LEVELS = ["read", "suggest", "execute"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export type ProviderId = "gmail" | "gcalendar" | "slack" | "github" | "linear" | "jira";

export type Category = "urgent" | "important" | "requires_response" | "requires_action" | "informational";

/** What a provider emits from sync()/webhooks. Stored in monitored_events. */
export interface NormalizedEvent {
  kind: string;            // e.g. "email.received"
  externalId: string;      // provider's id for the object
  occurredAt: Date;
  /** Distinguishes distinct events on the same object (e.g. a PR "review_requested" vs "closed"). */
  discriminator?: string;
  payload: Record<string, unknown>; // minimal metadata only
}
