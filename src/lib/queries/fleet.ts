"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Role, User, Vessel } from "@/lib/domain/types";

export function useVessels(enabled = true) {
  return useQuery({
    queryKey: ["vessels"],
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowserClient()
        .from("vessels").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Vessel[];
    },
  });
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: ["users"],
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowserClient()
        .from("users").select("*").order("full_name");
      if (error) throw error;
      return (data ?? []) as User[];
    },
  });
}

export function useAssignments(enabled = true) {
  return useQuery({
    queryKey: ["assignments"],
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowserClient()
        .from("vessel_assignments").select("id, user_id, vessel_id");
      if (error) throw error;
      return (data ?? []) as { id: string; user_id: string; vessel_id: string }[];
    },
  });
}

/** Crew aboard a vessel, with their current open-work count. */
export function useAssignableCrew(vesselId: string | null) {
  return useQuery({
    queryKey: ["assignable-crew", vesselId],
    enabled: Boolean(vesselId),
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const { data: assignments, error: aErr } = await supabase
        .from("vessel_assignments").select("user_id").eq("vessel_id", vesselId!);
      if (aErr) throw aErr;

      const ids = (assignments ?? []).map((a) => a.user_id);
      if (ids.length === 0) return [];

      const { data: users, error: uErr } = await supabase
        .from("users").select("id, full_name, email, role, is_active")
        .in("id", ids).eq("role", "crew").eq("is_active", true).order("full_name");
      if (uErr) throw uErr;

      const { data: load, error: lErr } = await supabase
        .from("work_orders").select("assignee_id")
        .eq("vessel_id", vesselId!).eq("is_closed", false);
      if (lErr) throw lErr;

      const counts = new Map<string, number>();
      for (const row of load ?? []) {
        counts.set(row.assignee_id, (counts.get(row.assignee_id) ?? 0) + 1);
      }

      // "Available" is not a capacity rule — nothing caps how much work a crew
      // member may hold. The count is shown so a captain can choose sensibly.
      return (users ?? []).map((u) => ({ ...u, open_work: counts.get(u.id) ?? 0 })) as
        (User & { open_work: number })[];
    },
  });
}

function useFleetMutation<TArgs>(run: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      for (const key of ["users", "vessels", "assignments", "assignable-crew"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export const useCreateUser = () =>
  useFleetMutation<{ full_name: string; email: string; role: Role }>(async (input) => {
    const { error } = await getSupabaseBrowserClient().from("users").insert(input);
    if (error) throw error;
  });

export const useUpdateUser = () =>
  useFleetMutation<{ id: string; changes: Partial<Pick<User, "full_name" | "email" | "role" | "is_active">> }>(
    async ({ id, changes }) => {
      const { error } = await getSupabaseBrowserClient().from("users").update(changes).eq("id", id);
      if (error) throw error;
    },
  );

export const useCreateVessel = () =>
  useFleetMutation<{ name: string; imo_number: string | null }>(async (input) => {
    const { error } = await getSupabaseBrowserClient().from("vessels").insert(input);
    if (error) throw error;
  });

export const useUpdateVessel = () =>
  useFleetMutation<{ id: string; changes: Partial<Pick<Vessel, "name" | "imo_number" | "is_active">> }>(
    async ({ id, changes }) => {
      const { error } = await getSupabaseBrowserClient().from("vessels").update(changes).eq("id", id);
      if (error) throw error;
    },
  );

export const useAssignToVessel = () =>
  useFleetMutation<{ user_id: string; vessel_id: string }>(async (input) => {
    const { error } = await getSupabaseBrowserClient().from("vessel_assignments").insert(input);
    if (error) throw error;
  });

export const useRemoveAssignment = () =>
  useFleetMutation<{ id: string }>(async ({ id }) => {
    const { error } = await getSupabaseBrowserClient().from("vessel_assignments").delete().eq("id", id);
    if (error) throw error;
  });
