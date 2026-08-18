import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The impersonation roster for the utility bar.
 *
 * This exists because of a bootstrap problem: the bar must render its three
 * dropdowns before anyone is impersonated, when the browser holds no token. The
 * alternative — granting `anon` read access to users and vessels — would mean
 * the public role could enumerate the entire crew list. Serving a deliberately
 * minimal projection from the server keeps `anon` at zero privilege.
 *
 * Only what the switcher needs is returned. No emails, no timestamps.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const [vessels, users, assignments] = await Promise.all([
    supabaseAdmin.from("vessels").select("id, name, is_active").order("name"),
    supabaseAdmin.from("users").select("id, full_name, role, is_active").order("full_name"),
    supabaseAdmin.from("vessel_assignments").select("user_id, vessel_id"),
  ]);

  const failure = vessels.error ?? users.error ?? assignments.error;
  if (failure) {
    return NextResponse.json({ error: failure.message }, { status: 500 });
  }

  const vesselsByUser = new Map<string, string[]>();
  for (const row of assignments.data ?? []) {
    const list = vesselsByUser.get(row.user_id) ?? [];
    list.push(row.vessel_id);
    vesselsByUser.set(row.user_id, list);
  }

  return NextResponse.json({
    vessels: (vessels.data ?? []).filter((v) => v.is_active),
    // Only active members may be impersonated: the brief asks the switcher to
    // list "active users belonging to the chosen role and vessel".
    members: (users.data ?? [])
      .filter((u) => u.is_active)
      .map((u) => ({
        id: u.id,
        full_name: u.full_name,
        role: u.role,
        vessel_ids: vesselsByUser.get(u.id) ?? [],
      })),
  });
}
