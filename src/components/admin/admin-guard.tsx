"use client";

import { useSession } from "@/lib/session/session-context";
import { NoSession } from "@/components/layout/no-session";
import { ShieldAlert } from "lucide-react";

/**
 * Hides admin screens from non-admins. This is courtesy, not security: the
 * queries underneath return nothing and every write is refused by RLS
 * regardless of what this component decides.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  if (!session) return <NoSession />;

  if (session.user.role !== "admin") {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-24 text-center">
        <div className="rounded-full bg-muted p-4">
          <ShieldAlert className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold">Admins only</h1>
        <p className="text-sm text-muted-foreground">
          You are acting as {session.user.full_name}, a {session.user.role}. Fleet
          administration is limited to admins — and not only in this interface:
          the database refuses these writes for any other role.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
