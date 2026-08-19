"use client";

import { useMemo } from "react";
import { Anchor, Loader2, ShieldCheck, Users } from "lucide-react";
import { useSession } from "@/lib/session/session-context";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/domain/types";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const ALL = "__all__";

/**
 * The mock authentication surface: three dependent dropdowns.
 *
 * Vessel narrows the roster; role narrows it further; picking a member switches
 * the session. Note what the vessel selection is NOT: it never widens access.
 * Authority comes from the database on every query, so choosing a vessel only
 * changes what is asked for, never what is permitted.
 */
export function UtilityBar() {
  const {
    roster, rosterError, session, selectedVesselId, roleFilter, switching,
    bootstrapping, switchMember, selectVessel, selectRole,
  } = useSession();

  // The roster arrives before a stored member is back on their feet, so the bar
  // is briefly populated but not yet answerable. Saying so beats offering a
  // switcher that is about to overwrite whatever the reviewer picks.
  const restoring = bootstrapping && Boolean(roster);
  const memberBusy = switching || restoring;

  const activeMember = session?.user ?? null;
  const isAdmin = activeMember?.role === "admin";

  // Admins reach the whole fleet; everyone else only their own postings.
  const selectableVessels = useMemo(() => {
    const all = roster?.vessels ?? [];
    if (!roster || !activeMember || isAdmin) return all;
    const me = roster.members.find((m) => m.id === activeMember.id);
    return all.filter((v) => me?.vessel_ids.includes(v.id));
  }, [roster, activeMember, isAdmin]);

  const members = useMemo(() => {
    if (!roster) return [];
    return roster.members.filter((m) => {
      if (roleFilter && m.role !== roleFilter) return false;
      if (!selectedVesselId) return true;
      // Admins are fleet-wide and hold no assignments, so a vessel filter must
      // not hide them — they would otherwise vanish from the switcher entirely.
      if (m.role === "admin") return true;
      return m.vessel_ids.includes(selectedVesselId);
    });
  }, [roster, roleFilter, selectedVesselId]);

  if (rosterError) {
    return (
      <div className="sticky top-0 z-50 border-b bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Could not load the roster: {rosterError}
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <Anchor className="size-5 text-primary" aria-hidden />
          <span className="font-semibold tracking-tight">Seafair</span>
          <Badge variant="outline" className="hidden sm:inline-flex text-[10px] uppercase tracking-wide">
            Review mode
          </Badge>
        </div>

        {!roster ? (
          <div className="flex flex-1 gap-3">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 flex-1" />
          </div>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            <Select
              value={selectedVesselId ?? ALL}
              onValueChange={(v) => selectVessel(v === ALL ? null : v)}
            >
              <SelectTrigger className="w-full" aria-label="Active vessel">
                <Anchor className="size-3.5 opacity-60" aria-hidden />
                <SelectValue placeholder="All vessels" />
              </SelectTrigger>
              <SelectContent>
                {(isAdmin || !activeMember) && <SelectItem value={ALL}>All vessels</SelectItem>}
                {selectableVessels.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={roleFilter ?? ALL}
              onValueChange={(v) => selectRole(v === ALL ? null : (v as Role))}
            >
              <SelectTrigger className="w-full" aria-label="Filter by role">
                <Users className="size-3.5 opacity-60" aria-hidden />
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={activeMember?.id ?? ""}
              onValueChange={(id) => void switchMember(id)}
              disabled={memberBusy}
            >
              <SelectTrigger className="w-full" aria-label="Active member">
                {memberBusy
                  ? <Loader2 className="size-3.5 animate-spin opacity-60" aria-hidden />
                  : <ShieldCheck className="size-3.5 opacity-60" aria-hidden />}
                <SelectValue
                  placeholder={restoring ? "Restoring session…" : "Choose a member to begin"}
                />
              </SelectTrigger>
              <SelectContent>
                {members.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground">
                    No active members match this vessel and role.
                  </div>
                ) : (
                  members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="flex w-full items-center gap-2">
                        <span className="truncate">{m.full_name}</span>
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                          {ROLE_LABELS[m.role]}
                        </span>
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
