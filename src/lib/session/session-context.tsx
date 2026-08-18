"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setSessionToken } from "@/lib/supabase/browser";
import type { ActiveSession, Roster } from "./types";
import type { Role } from "@/lib/domain/types";

const STORAGE_KEY = "seafair.session";

interface StoredSelection {
  userId: string | null;
  vesselId: string | null;
  roleFilter: Role | null;
}

interface SessionContextValue {
  roster: Roster | null;
  rosterError: string | null;
  session: ActiveSession | null;
  /** The vessel chosen in the utility bar. A view filter, never an authority. */
  selectedVesselId: string | null;
  roleFilter: Role | null;
  switching: boolean;
  switchMember: (userId: string) => Promise<void>;
  selectVessel: (vesselId: string | null) => void;
  selectRole: (role: Role | null) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);
  const [switching, setSwitching] = useState(false);
  const restored = useRef(false);

  const persist = useCallback((next: Partial<StoredSelection>) => {
    if (typeof window === "undefined") return;
    const current: StoredSelection = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '{"userId":null,"vesselId":null,"roleFilter":null}',
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...next }));
  }, []);

  const establish = useCallback(
    async (userId: string) => {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Could not switch member." }));
        throw new Error(error);
      }
      const next = (await res.json()) as ActiveSession;
      // Order matters: the token must be in place before any query refetches,
      // or an in-flight request would carry the previous member's identity.
      setSessionToken(next.token);
      setSession(next);
      return next;
    },
    [],
  );

  const switchMember = useCallback(
    async (userId: string) => {
      setSwitching(true);
      try {
        const next = await establish(userId);
        persist({ userId });
        // Everything cached belonged to the previous identity. Clearing rather
        // than invalidating means no stale row is ever rendered against the new
        // member's permissions, even for a frame.
        queryClient.clear();

        // An admin sees the whole fleet, so "All vessels" is a real option for
        // them. For a captain or crew member it is not offered — which means a
        // null selection would leave the Select with a value matching no item,
        // rendering blank. So they always land on a vessel they can actually
        // reach: the one they had, if still valid, otherwise their first.
        if (next.user.role !== "admin") {
          const member = roster?.members.find((m) => m.id === userId);
          const reachable = member?.vessel_ids ?? [];
          const keepCurrent = selectedVesselId && reachable.includes(selectedVesselId);
          if (!keepCurrent) {
            const fallback = reachable[0] ?? null;
            setSelectedVesselId(fallback);
            persist({ vesselId: fallback });
          }
        }
      } finally {
        setSwitching(false);
      }
    },
    [establish, persist, queryClient, roster, selectedVesselId],
  );

  const selectVessel = useCallback(
    (vesselId: string | null) => {
      setSelectedVesselId(vesselId);
      persist({ vesselId });
    },
    [persist],
  );

  const selectRole = useCallback(
    (role: Role | null) => {
      setRoleFilter(role);
      persist({ roleFilter: role });
    },
    [persist],
  );

  const signOut = useCallback(() => {
    setSessionToken(null);
    setSession(null);
    persist({ userId: null });
    queryClient.clear();
  }, [persist, queryClient]);

  // Load the roster, then restore whatever the reviewer was last looking at.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/roster");
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not load the roster.");
        const data = (await res.json()) as Roster;
        if (cancelled) return;
        setRoster(data);

        if (restored.current) return;
        restored.current = true;

        const stored: StoredSelection = JSON.parse(
          window.localStorage.getItem(STORAGE_KEY) ?? '{"userId":null,"vesselId":null,"roleFilter":null}',
        );
        const canRestoreMember =
          Boolean(stored.userId) && data.members.some((m) => m.id === stored.userId);

        if (stored.vesselId && data.vessels.some((v) => v.id === stored.vesselId)) {
          setSelectedVesselId(stored.vesselId);
        }

        // Only carry the role filter forward alongside the session it belonged
        // to. Restoring it on its own strands a returning visitor: the empty
        // state tells them to pick a specific admin, while a leftover "Crew"
        // filter quietly removes that person from the list.
        if (stored.roleFilter && canRestoreMember) setRoleFilter(stored.roleFilter);
        else persist({ roleFilter: null });

        if (canRestoreMember) {
          await establish(stored.userId!).catch(() => {});
        }
      } catch (error) {
        if (!cancelled) setRosterError((error as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [establish, persist]);

  // Re-mint before expiry so a long review session never dies mid-click.
  useEffect(() => {
    if (!session) return;
    const msUntilRefresh = session.expiresAt * 1000 - Date.now() - 60_000;
    const timer = setTimeout(() => {
      establish(session.user.id).catch(() => {});
    }, Math.max(msUntilRefresh, 5_000));
    return () => clearTimeout(timer);
  }, [session, establish]);

  const value = useMemo<SessionContextValue>(
    () => ({
      roster, rosterError, session, selectedVesselId, roleFilter, switching,
      switchMember, selectVessel, selectRole, signOut,
    }),
    [roster, rosterError, session, selectedVesselId, roleFilter, switching,
     switchMember, selectVessel, selectRole, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/** The active member, or null when nobody is impersonated yet. */
export function useActiveMember() {
  return useSession().session?.user ?? null;
}
