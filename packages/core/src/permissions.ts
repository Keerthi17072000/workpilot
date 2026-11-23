import { PERMISSION_LEVELS, type PermissionLevel } from "./types";

const rank = (l: PermissionLevel) => PERMISSION_LEVELS.indexOf(l);

export interface AuthorizeInput {
  /** Cap the user set on this integration. */
  integrationLevel: PermissionLevel;
  /** Level the operation needs. */
  required: PermissionLevel;
  /** User preference: EXECUTE needs explicit approval. */
  requireApproval: boolean;
  /** Is there an approved extracted_action for exactly this operation? */
  approved: boolean;
}

export type Decision = { allow: true } | { allow: false; reason: "level_too_low" | "approval_required" };

/** The single gate every tool call / action goes through. Callers must audit the result. */
export function authorize(i: AuthorizeInput): Decision {
  if (rank(i.integrationLevel) < rank(i.required)) return { allow: false, reason: "level_too_low" };
  if (i.required === "execute" && i.requireApproval && !i.approved) return { allow: false, reason: "approval_required" };
  return { allow: true };
}
