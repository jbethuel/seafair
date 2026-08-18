import type { Role } from "@/lib/domain/types";

export interface RosterVessel {
  id: string;
  name: string;
  is_active: boolean;
}

export interface RosterMember {
  id: string;
  full_name: string;
  role: Role;
  vessel_ids: string[];
}

export interface Roster {
  vessels: RosterVessel[];
  members: RosterMember[];
}

export interface ActiveSession {
  token: string;
  expiresAt: number;
  user: { id: string; full_name: string; email: string; role: Role };
}
