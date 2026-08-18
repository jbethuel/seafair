import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mintSessionToken } from "@/lib/session/mint";

/**
 * Switches the active member.
 *
 * Impersonation here is intentionally unauthenticated — that is precisely the
 * mock authentication the brief specifies, and docs/adr/0001 says so plainly.
 * What matters is that the mock stops at *identity*: this route will not mint a
 * token for a member who does not exist or has been deactivated, and every
 * question of *authority* is answered afterwards by the database.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({ userId: z.uuid() });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid member id is required." }, { status: 400 });
  }

  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("id, full_name, email, role, is_active")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!user) return NextResponse.json({ error: "No such member." }, { status: 404 });
  if (!user.is_active) {
    return NextResponse.json({ error: "That member is deactivated." }, { status: 403 });
  }

  const { token, expiresAt } = await mintSessionToken(user.id, user.role);

  return NextResponse.json({ token, expiresAt, user });
}
