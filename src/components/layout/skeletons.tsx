import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The loading shapes, in one place.
 *
 * Every one of these mirrors the real layout it stands in for — same widths,
 * same grid, same card structure — so the swap to real content moves nothing on
 * screen. A generic spinner would be less work and worse: it tells the reader
 * that something is happening but not what is about to appear.
 *
 * Deliberately free of client hooks so `loading.tsx` files can render them on
 * the server, before any of the app's JavaScript has run.
 */

function Line({ className }: { className?: string }) {
  return <Skeleton className={`h-4 ${className ?? ""}`} />;
}

/**
 * A placeholder that stands in for a word mid-sentence.
 *
 * `Skeleton` is a `<div>`, which browsers may not nest inside a `<p>` — it gets
 * hoisted out and the markup no longer matches what was rendered on the server.
 * This is the same shape as a `<span>`, carrying the slot attribute so the
 * reduced-motion rule still reaches it.
 */
export function InlineSkeleton({ className }: { className?: string }) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden
      className={cn("inline-block animate-pulse rounded-md bg-muted align-middle", className)}
    />
  );
}

export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-52" />
        <Line className="w-72 max-w-full" />
      </div>
      {withAction && <Skeleton className="h-7 w-36" />}
    </header>
  );
}

/** The dashboard's status filter row: five pills of settled width. */
export function FilterBarSkeleton() {
  // Widths repeat, so these are keyed by position rather than by value.
  const widths = ["w-16", "w-20", "w-28", "w-44", "w-20"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {widths.map((w, i) => <Skeleton key={i} className={`h-8 ${w}`} />)}
    </div>
  );
}

export function RowsSkeleton({ rows = 6, className = "h-16" }: { rows?: number; className?: string }) {
  return (
    <div className="space-y-2" aria-busy aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`w-full ${className}`} />
      ))}
    </div>
  );
}

export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy aria-label="Loading">
      {Array.from({ length: cards }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}

/** The work orders dashboard, before a session or its first page of rows exists. */
export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <PageHeaderSkeleton withAction />
      <FilterBarSkeleton />
      <RowsSkeleton />
    </div>
  );
}

/** One work order, laid out as the real page lays it out: three cards then one. */
export function WorkOrderDetailSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6" aria-busy aria-label="Loading work order">
      <Skeleton className="h-5 w-32" />

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <Skeleton className="h-7 w-3/4" />
        <Line className="w-2/3" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {[3, 2, 4].map((lines, card) => (
            <Card key={card}>
              <CardHeader><Skeleton className="h-5 w-24" /></CardHeader>
              <CardContent className="space-y-2">
                {Array.from({ length: lines }).map((_, i) => (
                  <Line key={i} className={i === lines - 1 ? "w-1/2" : "w-full"} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader><Skeleton className="h-5 w-20" /></CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-32" />
              <Line className="w-3/4" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Shell for the admin screens, whose header copy is not yet on the page. */
function AdminPageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <PageHeaderSkeleton withAction />
      {children}
    </div>
  );
}

export function UsersPageSkeleton() {
  return (
    <AdminPageSkeleton>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-7 w-36" />
        <Skeleton className="ml-auto h-4 w-20" />
      </div>
      <RowsSkeleton rows={8} className="h-14" />
    </AdminPageSkeleton>
  );
}

export function VesselsPageSkeleton() {
  return <AdminPageSkeleton><CardGridSkeleton /></AdminPageSkeleton>;
}

export function AssignmentsPageSkeleton() {
  return (
    <AdminPageSkeleton>
      <div className="space-y-3" aria-busy aria-label="Loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    </AdminPageSkeleton>
  );
}
