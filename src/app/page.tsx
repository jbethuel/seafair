"use client";

import { useMemo, useState } from "react";
import { useSession } from "@/lib/session/session-context";
import {
  useWorkOrderTallies, type WorkOrderFilters, type WorkOrderTallies,
} from "@/lib/queries/work-orders";
import { WorkOrderList } from "@/components/work-orders/work-order-list";
import { CreateWorkOrderDialog } from "@/components/work-orders/create-work-order-dialog";
import { NoSession } from "@/components/layout/no-session";
import { DashboardSkeleton } from "@/components/layout/skeletons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkOrderStatus } from "@/lib/domain/types";

type Filter = WorkOrderStatus | "awaiting" | null;

const FILTERS: { value: Filter; label: string; tally: keyof WorkOrderTallies }[] = [
  { value: null, label: "All", tally: "total" },
  { value: "open", label: "Open", tally: "open" },
  { value: "in_progress", label: "In Progress", tally: "in_progress" },
  { value: "awaiting", label: "Awaiting attestation", tally: "awaiting_attestation" },
  { value: "done", label: "Done", tally: "done" },
];

export default function DashboardPage() {
  const { session, selectedVesselId, roster, bootstrapping } = useSession();
  const [filter, setFilter] = useState<Filter>(null);

  const vesselName = useMemo(
    () => roster?.vessels.find((v) => v.id === selectedVesselId)?.name,
    [roster, selectedVesselId],
  );

  const talliesQuery = useWorkOrderTallies(selectedVesselId, Boolean(session));
  const tallies = talliesQuery.data;

  if (bootstrapping) return <DashboardSkeleton />;
  if (!session) return <NoSession />;

  const isCaptain = session.user.role === "captain";
  const filters: WorkOrderFilters = { vesselId: selectedVesselId, status: filter };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {vesselName ?? "All vessels"}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {session.user.role === "crew"
              ? "Work orders assigned to you."
              : session.user.role === "captain"
                ? "Work orders aboard your vessel."
                : selectedVesselId
                  ? "Every work order aboard this vessel."
                  : "Every work order in the fleet."}
          </p>
        </div>

        {isCaptain && selectedVesselId && (
          <CreateWorkOrderDialog vesselId={selectedVesselId} />
        )}
        {isCaptain && !selectedVesselId && (
          <p className="text-xs text-muted-foreground">
            Choose a vessel above to raise a work order.
          </p>
        )}
      </header>

      <div className="flex flex-wrap gap-1.5" data-testid="status-filters">
        {FILTERS.map((f) => (
          <Button
            key={f.label}
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            onClick={() => setFilter(f.value)}
            className={cn("h-8", filter === f.value && "shadow-sm")}
          >
            {f.label}
            {/* Rendered whether or not the count has arrived: a badge that
                appears late resizes the pill under the pointer. */}
            <span className={cn(
              "ml-1.5 inline-flex min-w-6 justify-center rounded px-1.5 py-0.5 text-[10px] tabular-nums transition-opacity",
              filter === f.value ? "bg-primary-foreground/20" : "bg-muted",
              talliesQuery.isPlaceholderData && "opacity-50",
            )}>
              {tallies
                ? tallies[f.tally]
                : <span className="h-2.5 w-3 animate-pulse self-center rounded-sm bg-current opacity-30" />}
            </span>
          </Button>
        ))}
      </div>

      <WorkOrderList filters={filters} />
    </div>
  );
}
