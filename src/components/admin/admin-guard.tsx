"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/lib/session/session-context";
import { NoSession } from "@/components/layout/no-session";
import { DashboardSkeleton } from "@/components/layout/skeletons";

/**
 * Keeps admin screens to admins. This is courtesy, not security: the queries
 * underneath return nothing and every write is refused by RLS regardless of
 * what this component decides.
 *
 * A member without the role is sent back to the work orders rather than shown a
 * wall. The case that matters is switching member while an admin tab is open —
 * the reviewer did not navigate anywhere, so leaving them parked on a screen
 * that no longer applies, with its tab already gone from the nav, strands them.
 * `replace` rather than `push`, so Back does not bounce them straight in again.
 */
export function AdminGuard({
  children, fallback,
}: { children: React.ReactNode; fallback: React.ReactNode }) {
  const { session, bootstrapping } = useSession();
  const router = useRouter();

  const isAdmin = session?.user.role === "admin";
  const turnAway = !bootstrapping && Boolean(session) && !isAdmin;

  useEffect(() => {
    if (!turnAway) return;
    router.replace("/");
    // A page changing under you with no explanation reads as a glitch. The
    // fixed id keeps a re-run from stacking a second copy of the same notice.
    toast.info("Fleet administration is limited to admins.", { id: "admin-only" });
  }, [turnAway, router]);

  // Before the stored member is back, this cannot yet know whether to turn them
  // away — and guessing wrongly, then taking it back, reads as a change of mind.
  if (bootstrapping) return <>{fallback}</>;
  if (!session) return <NoSession />;
  // The shape of where they are going, not of the page they cannot have.
  if (!isAdmin) return <DashboardSkeleton />;

  return <>{children}</>;
}
