"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Ship, UserCog, Users } from "lucide-react";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Work Orders", icon: ClipboardList, adminOnly: false },
  { href: "/admin/users", label: "Users", icon: Users, adminOnly: true },
  { href: "/admin/vessels", label: "Vessels", icon: Ship, adminOnly: true },
  { href: "/admin/assignments", label: "Assignments", icon: UserCog, adminOnly: true },
];

/**
 * Admin links are hidden for non-admins, but hiding is only tidiness — the
 * pages themselves return nothing useful without the role, because RLS refuses
 * the underlying reads. Navigation is never the enforcement point.
 */
export function AppNav() {
  const pathname = usePathname();
  const { session } = useSession();
  const isAdmin = session?.user.role === "admin";
  if (!session) return null;

  const visible = LINKS.filter((l) => !l.adminOnly || isAdmin);
  if (visible.length <= 1) return null;

  return (
    <nav className="border-b bg-muted/30">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 sm:px-4">
        {visible.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
