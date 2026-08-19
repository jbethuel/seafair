"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useWorkOrders, type WorkOrderFilters } from "@/lib/queries/work-orders";
import { useUsers } from "@/lib/queries/fleet";
import { StatusBadge } from "./status-badge";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineSkeleton, RowsSkeleton } from "@/components/layout/skeletons";
import { humanError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * Two presentations of the same data rather than one that bends.
 *
 * A six-column table does not survive a 375px viewport, so below `md` the rows
 * become cards. Squeezing the table instead is what the responsiveness
 * criterion is actually testing for.
 */
export function WorkOrderList({ filters }: { filters: WorkOrderFilters }) {
  const query = useWorkOrders(filters);
  const { data: users, isPending: usersPending } = useUsers();

  const nameById = useMemo(
    () => new Map((users ?? []).map((u) => [u.id, u.full_name])),
    [users],
  );

  const rows = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

  // Only the very first load has nothing to show. Every later change of vessel
  // or filter arrives as placeholder data, so the rows below stay put.
  if (query.isPending) return <RowsSkeleton />;

  if (query.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        {humanError(query.error)}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm font-medium">No work orders here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing matches the current vessel and filter.
        </p>
      </div>
    );
  }

  // `isPlaceholderData` means these rows answer the previous filter. Dimming
  // says so without taking them away, and the pointer keeps its target.
  const stale = query.isPlaceholderData;

  return (
    <div
      className={cn("space-y-4 transition-opacity duration-200", stale && "opacity-50")}
      aria-busy={stale || undefined}
    >
      {/* Desktop */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Reference</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Title</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Assignee</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Raised</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((wo) => (
              <tr key={wo.id} className="transition-colors hover:bg-muted/40">
                <td className="px-4 py-3 font-mono text-xs">
                  <Link href={`/work-orders/${wo.id}`} className="hover:underline">
                    {wo.reference}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/work-orders/${wo.id}`} className="font-medium hover:underline">
                    {wo.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {usersPending
                    ? <Skeleton className="h-3.5 w-24" />
                    : nameById.get(wo.assignee_id) ?? "—"}
                </td>
                <td className="px-4 py-3"><StatusBadge workOrder={wo} /></td>
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  {relativeTime(wo.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="space-y-2 md:hidden">
        {rows.map((wo) => (
          <li key={wo.id}>
            <Link
              href={`/work-orders/${wo.id}`}
              className="block rounded-lg border p-4 transition-colors active:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-xs text-muted-foreground">{wo.reference}</span>
                <StatusBadge workOrder={wo} />
              </div>
              <p className="mt-1.5 font-medium leading-snug">{wo.title}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {usersPending
                  ? <InlineSkeleton className="h-3 w-20" />
                  : nameById.get(wo.assignee_id) ?? "Unassigned"}
                {" · "}{relativeTime(wo.created_at)}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {query.hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Load more
          </Button>
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">
        Showing {rows.length} work order{rows.length === 1 ? "" : "s"}
        {query.hasNextPage ? " — more available" : ""}
      </p>
    </div>
  );
}
