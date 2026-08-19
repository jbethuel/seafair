import { WorkOrderDetailSkeleton } from "@/components/layout/skeletons";

/**
 * Shown the instant a work order link is clicked, before this segment's code
 * has arrived — the same shape the page itself falls back to while its data
 * loads, so the two hand over without a visible change.
 */
export default function Loading() {
  return <WorkOrderDetailSkeleton />;
}
