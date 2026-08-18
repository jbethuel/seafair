"use client";

import { useMemo } from "react";
import {
  CheckCircle2, CirclePlus, MessageSquareX, PencilLine, PlayCircle, Send, ShieldCheck, UserRoundCog,
} from "lucide-react";
import { useWorkOrderTimeline } from "@/lib/queries/work-orders";
import { useUsers } from "@/lib/queries/fleet";
import { absoluteTime, relativeTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

const PRESENTATION: Record<string, { icon: typeof CirclePlus; label: string; tone: string }> = {
  created:              { icon: CirclePlus,      label: "raised this work order",   tone: "text-muted-foreground" },
  assigned:             { icon: UserRoundCog,    label: "assigned it",              tone: "text-muted-foreground" },
  reassigned:           { icon: UserRoundCog,    label: "reassigned it",            tone: "text-blue-600 dark:text-blue-400" },
  status_changed:       { icon: PlayCircle,      label: "started work",             tone: "text-blue-600 dark:text-blue-400" },
  solution_updated:     { icon: PencilLine,      label: "updated the solution",     tone: "text-muted-foreground" },
  submitted_for_review: { icon: Send,            label: "marked it done",           tone: "text-amber-600 dark:text-amber-400" },
  attested:             { icon: ShieldCheck,     label: "attested it",              tone: "text-emerald-600 dark:text-emerald-400" },
  rejected:             { icon: MessageSquareX,  label: "rejected it",              tone: "text-destructive" },
};

export function Timeline({ workOrderId }: { workOrderId: string }) {
  const { data: events, isPending } = useWorkOrderTimeline(workOrderId);
  const { data: users } = useUsers();
  const nameById = useMemo(
    () => new Map((users ?? []).map((u) => [u.id, u.full_name])), [users]);

  if (isPending) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => (
      <Skeleton key={i} className="h-12 w-full" />))}</div>;
  }
  if (!events?.length) {
    return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <ol className="relative space-y-4 border-l pl-6">
      {events.map((e) => {
        const p = PRESENTATION[e.type] ?? {
          icon: CheckCircle2, label: e.type, tone: "text-muted-foreground",
        };
        const Icon = p.icon;
        const meta = (e.metadata ?? {}) as Record<string, string>;
        return (
          <li key={e.id} className="relative">
            <span className="absolute -left-[31px] flex size-5 items-center justify-center rounded-full bg-background ring-4 ring-background">
              <Icon className={`size-4 ${p.tone}`} aria-hidden />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
              <span className="font-medium">{nameById.get(e.actor_id ?? "") ?? "Someone"}</span>
              <span className="text-muted-foreground">{p.label}</span>
              {e.type === "reassigned" && meta.to_name && (
                <span className="text-muted-foreground">
                  from {meta.from_name} to {meta.to_name}
                </span>
              )}
              <time
                className="ml-auto shrink-0 text-xs text-muted-foreground"
                dateTime={e.created_at}
                title={absoluteTime(e.created_at)}
              >
                {relativeTime(e.created_at)}
              </time>
            </div>
            {e.comment && (
              <blockquote className="mt-1.5 rounded-md border-l-2 border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                {e.comment}
              </blockquote>
            )}
          </li>
        );
      })}
    </ol>
  );
}
