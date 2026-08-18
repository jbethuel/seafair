import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type WorkOrder } from "@/lib/domain/types";
import { CheckCircle2, CircleDot, Clock, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shows Status and review state together without pretending review is a status.
 * A Done work order reads "Awaiting attestation" until a captain closes it.
 */
export function StatusBadge({
  workOrder, className,
}: { workOrder: Pick<WorkOrder, "status" | "attested_at">; className?: string }) {
  if (workOrder.status === "done" && workOrder.attested_at) {
    return (
      <Badge className={cn("gap-1 border-transparent bg-emerald-600/15 text-emerald-700 dark:text-emerald-400", className)}>
        <ShieldCheck className="size-3" aria-hidden /> Attested
      </Badge>
    );
  }
  if (workOrder.status === "done") {
    return (
      <Badge className={cn("gap-1 border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400", className)}>
        <Clock className="size-3" aria-hidden /> Awaiting attestation
      </Badge>
    );
  }
  if (workOrder.status === "in_progress") {
    return (
      <Badge className={cn("gap-1 border-transparent bg-blue-600/15 text-blue-700 dark:text-blue-400", className)}>
        <CircleDot className="size-3" aria-hidden /> {STATUS_LABELS.in_progress}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={cn("gap-1", className)}>
      <CheckCircle2 className="size-3 opacity-0" aria-hidden /> {STATUS_LABELS.open}
    </Badge>
  );
}
