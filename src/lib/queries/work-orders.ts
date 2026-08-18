"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { WorkOrder, WorkOrderStatus } from "@/lib/domain/types";

export const PAGE_SIZE = 25;

export interface WorkOrderFilters {
  vesselId: string | null;
  status: WorkOrderStatus | "awaiting" | null;
  assigneeId?: string | null;
}

interface Cursor {
  createdAt: string;
  id: string;
}

/**
 * Cursor pagination on (created_at desc, id desc).
 *
 * Deliberately not `.range()`: offset pagination re-scans everything it skips,
 * and shifts rows under the reader whenever a work order is raised mid-scroll.
 * The composite cursor is stable and the index serves it directly.
 */
export function useWorkOrders(filters: WorkOrderFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["work-orders", filters],
    enabled,
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam }) => {
      const supabase = getSupabaseBrowserClient();
      let query = supabase
        .from("work_orders")
        .select("id, reference, vessel_id, title, issue, solution, status, created_by, assignee_id, attested_at, attested_by, is_closed, created_at, updated_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);

      if (filters.vesselId) query = query.eq("vessel_id", filters.vesselId);
      if (filters.assigneeId) query = query.eq("assignee_id", filters.assigneeId);

      if (filters.status === "awaiting") {
        query = query.eq("status", "done").is("attested_at", null);
      } else if (filters.status) {
        query = query.eq("status", filters.status);
      }

      if (pageParam) {
        query = query.or(
          `created_at.lt.${pageParam.createdAt},and(created_at.eq.${pageParam.createdAt},id.lt.${pageParam.id})`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as WorkOrder[];
    },
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE
        ? undefined
        : { createdAt: lastPage.at(-1)!.created_at, id: lastPage.at(-1)!.id },
  });
}

export function useWorkOrder(id: string | null) {
  return useQuery({
    queryKey: ["work-order", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowserClient()
        .from("work_orders").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as WorkOrder | null;
    },
  });
}

export function useWorkOrderTimeline(id: string | null) {
  return useQuery({
    queryKey: ["work-order-events", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowserClient()
        .from("work_order_events")
        .select("id, actor_id, type, from_status, to_status, comment, metadata, created_at")
        .eq("work_order_id", id!)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Status tallies for the selected vessel, as one grouped round trip. */
export function useWorkOrderTallies(vesselId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["work-order-tallies", vesselId],
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowserClient()
        .rpc("work_order_tallies", { p_vessel_id: vesselId });
      if (error) throw error;
      return data as {
        open: number; in_progress: number; done: number;
        awaiting_attestation: number; closed: number; total: number;
      };
    },
  });
}

/** Every lifecycle mutation goes through a database function; see ADR 0004. */
function useLifecycleMutation<TArgs>(fn: string, buildArgs: (args: TArgs) => Record<string, unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      const { data, error } = await getSupabaseBrowserClient().rpc(fn, buildArgs(args));
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-events"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-tallies"] });
    },
  });
}

export const useCreateWorkOrder = () =>
  useLifecycleMutation<{ vesselId: string; title: string; issue: string; assigneeId: string }>(
    "create_work_order",
    (a) => ({ p_vessel_id: a.vesselId, p_title: a.title, p_issue: a.issue, p_assignee_id: a.assigneeId }),
  );

export const useStartWorkOrder = () =>
  useLifecycleMutation<{ id: string }>("start_work_order", (a) => ({ p_work_order_id: a.id }));

export const useSaveSolution = () =>
  useLifecycleMutation<{ id: string; solution: string }>(
    "save_solution", (a) => ({ p_work_order_id: a.id, p_solution: a.solution }));

export const useCompleteWorkOrder = () =>
  useLifecycleMutation<{ id: string; solution: string }>(
    "complete_work_order", (a) => ({ p_work_order_id: a.id, p_solution: a.solution }));

export const useAttestWorkOrder = () =>
  useLifecycleMutation<{ id: string }>("attest_work_order", (a) => ({ p_work_order_id: a.id }));

export const useRejectWorkOrder = () =>
  useLifecycleMutation<{ id: string; reason: string }>(
    "reject_work_order", (a) => ({ p_work_order_id: a.id, p_reason: a.reason }));

export const useReassignWorkOrder = () =>
  useLifecycleMutation<{ id: string; assigneeId: string }>(
    "reassign_work_order", (a) => ({ p_work_order_id: a.id, p_new_assignee_id: a.assigneeId }));
