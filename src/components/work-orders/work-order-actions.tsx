"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, PlayCircle, Send, ShieldCheck, ThumbsDown, UserRoundCog } from "lucide-react";
import {
  useAttestWorkOrder, useCompleteWorkOrder, useReassignWorkOrder,
  useRejectWorkOrder, useSaveSolution, useStartWorkOrder,
} from "@/lib/queries/work-orders";
import { useAssignableCrew } from "@/lib/queries/fleet";
import { humanError } from "@/lib/errors";
import type { WorkOrder } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Props {
  workOrder: WorkOrder;
  role: "admin" | "captain" | "crew";
  isAssignee: boolean;
}

export function WorkOrderActions({ workOrder, role, isAssignee }: Props) {
  if (workOrder.is_closed) {
    return (
      <p className="rounded-md bg-emerald-600/10 px-3 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
        This work order is closed. Attested records are permanent and cannot be reopened.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {role === "crew" && isAssignee && <CrewActions workOrder={workOrder} />}
      {role === "captain" && <CaptainActions workOrder={workOrder} />}
      {role === "admin" && <AdminActions workOrder={workOrder} />}
      {role === "crew" && !isAssignee && (
        <p className="text-sm text-muted-foreground">
          This work order is assigned to someone else.
        </p>
      )}
    </div>
  );
}

function CrewActions({ workOrder }: { workOrder: WorkOrder }) {
  const [solution, setSolution] = useState(workOrder.solution ?? "");
  const start = useStartWorkOrder();
  const save = useSaveSolution();
  const complete = useCompleteWorkOrder();

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try { await fn(); toast.success(success); }
    catch (error) { toast.error(humanError(error)); }
  };

  if (workOrder.status === "open") {
    return (
      <Button
        onClick={() => void run(() => start.mutateAsync({ id: workOrder.id }), "Work started.")}
        disabled={start.isPending}
      >
        {start.isPending
          ? <Loader2 className="size-4 animate-spin" aria-hidden />
          : <PlayCircle className="size-4" aria-hidden />}
        Start work
      </Button>
    );
  }

  if (workOrder.status === "in_progress") {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="solution">Solution</Label>
          <Textarea
            id="solution" rows={5} value={solution}
            onChange={(e) => setSolution(e.target.value)}
            placeholder="What did you do to put it right?"
          />
          <p className="text-xs text-muted-foreground">
            Required before this can be marked done — the database refuses it otherwise.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void run(
              () => save.mutateAsync({ id: workOrder.id, solution }), "Solution saved.")}
            disabled={save.isPending || solution.trim().length === 0}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save draft
          </Button>
          <Button
            onClick={() => void run(
              () => complete.mutateAsync({ id: workOrder.id, solution }),
              "Marked done and sent for review.")}
            disabled={complete.isPending || solution.trim().length === 0}
          >
            {complete.isPending
              ? <Loader2 className="size-4 animate-spin" aria-hidden />
              : <Send className="size-4" aria-hidden />}
            Mark as done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <p className="rounded-md bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
      With the captain for review. You will be able to edit again only if it is rejected.
    </p>
  );
}

function CaptainActions({ workOrder }: { workOrder: WorkOrder }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const attest = useAttestWorkOrder();
  const reject = useRejectWorkOrder();

  if (workOrder.status !== "done") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Nothing to review yet — this becomes reviewable once the assigned crew
          member marks it done.
        </p>
        <ReassignControl workOrder={workOrder} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            try {
              await attest.mutateAsync({ id: workOrder.id });
              toast.success("Attested and closed.");
            } catch (error) { toast.error(humanError(error)); }
          }}
          disabled={attest.isPending}
        >
          {attest.isPending
            ? <Loader2 className="size-4 animate-spin" aria-hidden />
            : <ShieldCheck className="size-4" aria-hidden />}
          Attest
        </Button>
        <Button variant="outline" onClick={() => setRejecting(true)}>
          <ThumbsDown className="size-4" aria-hidden /> Reject
        </Button>
      </div>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject {workOrder.reference}</DialogTitle>
            <DialogDescription>
              It returns to the assigned crew member as In Progress. A reason is
              required, and is kept permanently in the timeline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason" rows={4} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What still needs putting right?"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={reject.isPending || reason.trim().length === 0}
              onClick={async () => {
                try {
                  await reject.mutateAsync({ id: workOrder.id, reason });
                  toast.success("Sent back to the crew.");
                  setRejecting(false); setReason("");
                } catch (error) { toast.error(humanError(error)); }
              }}
            >
              {reject.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReassignControl workOrder={workOrder} />
    </div>
  );
}

function AdminActions({ workOrder }: { workOrder: WorkOrder }) {
  return (
    <div className="space-y-3">
      {/* The disabled control explains itself rather than looking broken. */}
      <div className="rounded-md border bg-muted/40 px-3 py-2.5">
        <p className="text-sm font-medium">Attestation is reserved for captains</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Admins manage the fleet and its people but take no part in the work
          order lifecycle — whoever controls the roster should not also sign off
          the work performed by it. Reassignment is available, which is how a
          deactivation is unblocked.
        </p>
      </div>
      <ReassignControl workOrder={workOrder} />
    </div>
  );
}

function ReassignControl({ workOrder }: { workOrder: WorkOrder }) {
  const [open, setOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const { data: crew } = useAssignableCrew(open ? workOrder.vessel_id : null);
  const reassign = useReassignWorkOrder();

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <UserRoundCog className="size-4" aria-hidden /> Reassign
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign {workOrder.reference}</DialogTitle>
            <DialogDescription>
              Only active crew assigned to this vessel can take it on.
            </DialogDescription>
          </DialogHeader>
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a crew member" />
            </SelectTrigger>
            <SelectContent>
              {(crew ?? [])
                .filter((c) => c.id !== workOrder.assignee_id)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex w-full items-center gap-2">
                      <span className="truncate">{c.full_name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {c.open_work} open
                      </span>
                    </span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!assigneeId || reassign.isPending}
              onClick={async () => {
                try {
                  await reassign.mutateAsync({ id: workOrder.id, assigneeId });
                  toast.success("Reassigned.");
                  setOpen(false); setAssigneeId("");
                } catch (error) { toast.error(humanError(error)); }
              }}
            >
              {reassign.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
