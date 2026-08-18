/** Vocabulary mirrors CONTEXT.md; see that file before renaming anything here. */

export const ROLES = ["admin", "captain", "crew"] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = ["open", "in_progress", "done"] as const;
export type WorkOrderStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  done: "Done",
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  captain: "Captain",
  crew: "Crew",
};

export interface User {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
}

export interface Vessel {
  id: string;
  name: string;
  imo_number: string | null;
  is_active: boolean;
}

export interface WorkOrder {
  id: string;
  reference: string;
  vessel_id: string;
  title: string;
  issue: string;
  solution: string | null;
  status: WorkOrderStatus;
  created_by: string;
  assignee_id: string;
  attested_at: string | null;
  attested_by: string | null;
  is_closed: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A Work Order that is Done but not yet attested is awaiting the captain.
 * Review state is deliberately not a Status — see docs/adr/0003.
 */
export function reviewState(wo: Pick<WorkOrder, "status" | "attested_at">) {
  if (wo.status !== "done") return "in_flight" as const;
  return wo.attested_at ? ("closed" as const) : ("awaiting_attestation" as const);
}
