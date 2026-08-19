"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/session/session-context";
import { useWorkOrder } from "@/lib/queries/work-orders";
import { useUsers, useVessels } from "@/lib/queries/fleet";
import { StatusBadge } from "@/components/work-orders/status-badge";
import { Timeline } from "@/components/work-orders/timeline";
import { WorkOrderActions } from "@/components/work-orders/work-order-actions";
import { NoSession } from "@/components/layout/no-session";
import { absoluteTime } from "@/lib/format";
import { InlineSkeleton, WorkOrderDetailSkeleton } from "@/components/layout/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function WorkOrderPage({ params }: PageProps<"/work-orders/[id]">) {
  const { id } = use(params);
  const { session, bootstrapping } = useSession();
  const { data: workOrder, isPending, isError } = useWorkOrder(session ? id : null);
  const { data: users } = useUsers(Boolean(session));
  const { data: vessels } = useVessels(Boolean(session));

  const nameById = useMemo(
    () => new Map((users ?? []).map((u) => [u.id, u.full_name])), [users]);
  const vesselName = useMemo(
    () => vessels?.find((v) => v.id === workOrder?.vessel_id)?.name,
    [vessels, workOrder]);

  // A deep link lands here before the stored session has been re-established.
  // The skeleton covers both that wait and the work order's own fetch, so the
  // page settles once rather than flashing "not available" in between.
  if (bootstrapping) return <WorkOrderDetailSkeleton />;
  if (!session) return <NoSession />;
  if (isPending) return <WorkOrderDetailSkeleton />;

  // RLS returns nothing rather than refusing, so "not found" and "not yours"
  // are deliberately indistinguishable from here — which is the point.
  if (isError || !workOrder) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">Not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This work order does not exist, or it is not visible to the member you
          are currently acting as.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm underline">
          Back to work orders
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Work orders
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{workOrder.reference}</span>
          <StatusBadge workOrder={workOrder} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{workOrder.title}</h1>
        <p className="text-sm text-muted-foreground">
          {vesselName ?? <InlineSkeleton className="h-3.5 w-28" />}
          {" · "}assigned to {nameById.get(workOrder.assignee_id)
            ?? <InlineSkeleton className="h-3.5 w-24" />}
          {" · "}raised by {nameById.get(workOrder.created_by)
            ?? <InlineSkeleton className="h-3.5 w-24" />}
          {" on "}{absoluteTime(workOrder.created_at)}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Issue</CardTitle></CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
              {workOrder.issue}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Solution</CardTitle></CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
              {workOrder.solution ?? (
                <span className="text-muted-foreground">Not documented yet.</span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
            <CardContent><Timeline workOrderId={workOrder.id} /></CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="lg:sticky lg:top-32">
            <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
            <CardContent>
              <WorkOrderActions
                workOrder={workOrder}
                role={session.user.role}
                isAssignee={workOrder.assignee_id === session.user.id}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
