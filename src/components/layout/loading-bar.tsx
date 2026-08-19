"use client";

import { useIsFetching } from "@tanstack/react-query";
import { useSession } from "@/lib/session/session-context";

/**
 * One thread of movement across the top of the window whenever the app is
 * waiting on the network.
 *
 * It exists for the waits that no single component owns: restoring a session on
 * load, and switching member — which clears the cache, so every screen refetches
 * at once. Skeletons say what is coming back; this says the app is still going.
 *
 * The quarter-second it holds back before appearing is done in CSS rather than
 * with a timer, so there is no state to keep in step with the queries. Most
 * requests here finish inside that delay and the bar never shows at all, which
 * is the point — a bar that flickers on every fast query is noise, not feedback.
 */
export function LoadingBar() {
  const fetching = useIsFetching();
  const { switching, bootstrapping } = useSession();
  const busy = switching || bootstrapping || fetching > 0;

  return (
    <div
      aria-hidden
      data-busy={busy}
      className="seafair-progress pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden"
    >
      <div className="seafair-progress-sweep h-full w-2/5 rounded-full bg-primary" />
    </div>
  );
}
