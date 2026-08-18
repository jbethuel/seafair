"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { AdminGuard } from "@/components/admin/admin-guard";
import { AdminPageShell } from "@/components/admin/page-shell";
import {
  useAssignments, useAssignToVessel, useRemoveAssignment, useUsers, useVessels,
} from "@/lib/queries/fleet";
import { humanError } from "@/lib/errors";
import { ROLE_LABELS } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function AssignmentsPage() {
  return <AdminGuard><AssignmentsScreen /></AdminGuard>;
}

function AssignmentsScreen() {
  const { data: vessels, isPending: vesselsPending } = useVessels();
  const { data: users } = useUsers();
  const { data: assignments, isPending: assignmentsPending } = useAssignments();

  const usersById = useMemo(
    () => new Map((users ?? []).map((u) => [u.id, u])), [users]);

  const byVessel = useMemo(() => {
    const map = new Map<string, typeof assignments>();
    for (const a of assignments ?? []) {
      map.set(a.vessel_id, [...(map.get(a.vessel_id) ?? []), a]);
    }
    return map;
  }, [assignments]);

  if (vesselsPending || assignmentsPending) {
    return (
      <AdminPageShell title="Assignments" description="Who sails on what.">
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell
      title="Assignments"
      description="Who sails on what. Admins hold no assignments — their reach is fleet-wide. Removing someone who still owns open work aboard that vessel, or the last active captain of a vessel with open work, is refused by the database."
    >
      <div className="space-y-4">
        {(vessels ?? []).map((vessel) => {
          const crew = (byVessel.get(vessel.id) ?? [])
            .map((a) => ({ ...a, user: usersById.get(a.user_id) }))
            .filter((a) => a.user)
            .sort((a, b) =>
              a.user!.role.localeCompare(b.user!.role) ||
              a.user!.full_name.localeCompare(b.user!.full_name));

          return (
            <section key={vessel.id} className="rounded-lg border">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium">{vessel.name}</h2>
                  {!vessel.is_active && <Badge variant="outline">Deactivated</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {crew.length} aboard
                  </span>
                </div>
                <AssignDialog vesselId={vessel.id} vesselName={vessel.name}
                  assignedIds={new Set(crew.map((c) => c.user_id))} />
              </header>

              {crew.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Nobody is assigned to this vessel yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {crew.map((a) => (
                    <AssignmentRow key={a.id} id={a.id}
                      name={a.user!.full_name} role={a.user!.role}
                      isActive={a.user!.is_active} vesselName={vessel.name} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </AdminPageShell>
  );
}

function AssignmentRow({
  id, name, role, isActive, vesselName,
}: { id: string; name: string; role: keyof typeof ROLE_LABELS; isActive: boolean; vesselName: string }) {
  const remove = useRemoveAssignment();
  return (
    <li className={`flex items-center justify-between gap-3 px-4 py-2.5 ${isActive ? "" : "opacity-60"}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm">{name}</span>
        <Badge variant="outline" className="text-[10px] uppercase">{ROLE_LABELS[role]}</Badge>
        {!isActive && <span className="text-xs text-muted-foreground">deactivated</span>}
      </div>
      <Button
        variant="ghost" size="sm" disabled={remove.isPending}
        onClick={async () => {
          try {
            await remove.mutateAsync({ id });
            toast.success(`${name} removed from ${vesselName}.`);
          } catch (error) {
            toast.error(humanError(error), { duration: 8000 });
          }
        }}
      >
        {remove.isPending
          ? <Loader2 className="size-4 animate-spin" aria-hidden />
          : <X className="size-4" aria-hidden />}
        <span className="sr-only sm:not-sr-only">Remove</span>
      </Button>
    </li>
  );
}

function AssignDialog({
  vesselId, vesselName, assignedIds,
}: { vesselId: string; vesselName: string; assignedIds: Set<string> }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const { data: users } = useUsers();
  const assign = useAssignToVessel();

  // Admins are excluded by the database too; filtering here keeps the list honest.
  const candidates = (users ?? []).filter(
    (u) => u.role !== "admin" && u.is_active && !assignedIds.has(u.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" aria-hidden /> Assign
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign to {vesselName}</DialogTitle>
          <DialogDescription>
            Captains and crew only. Admins already reach every vessel.
          </DialogDescription>
        </DialogHeader>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a person" />
          </SelectTrigger>
          <SelectContent>
            {candidates.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                Everyone eligible is already aboard.
              </div>
            ) : candidates.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                <span className="flex w-full items-center gap-2">
                  <span className="truncate">{u.full_name}</span>
                  <span className="ml-auto text-[10px] uppercase text-muted-foreground">
                    {ROLE_LABELS[u.role]}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!userId || assign.isPending}
            onClick={async () => {
              try {
                await assign.mutateAsync({ user_id: userId, vessel_id: vesselId });
                toast.success("Assigned.");
                setOpen(false); setUserId("");
              } catch (error) { toast.error(humanError(error)); }
            }}
          >
            {assign.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
