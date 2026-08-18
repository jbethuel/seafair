import "server-only";
import { SignJWT } from "jose";
import { serverEnv } from "@/lib/env.server";
import { publicEnv } from "@/lib/env";
import type { Role } from "@/lib/domain/types";

/**
 * Mints the impersonation token described in docs/adr/0001.
 *
 * The claims are deliberately thin: identity and, for the client's own UI
 * convenience, the role. Neither is trusted for authorization — every policy
 * looks the caller up live, so revoking an assignment or changing a role takes
 * effect on the next query rather than at token expiry.
 */
const TOKEN_TTL_SECONDS = 60 * 60;

export interface MintedSession {
  token: string;
  expiresAt: number;
}

export async function mintSessionToken(userId: string, role: Role): Promise<MintedSession> {
  const secret = serverEnv.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "SUPABASE_JWT_SECRET is not set. This project may only offer asymmetric " +
        "JWT signing keys; see docs/adr/0001 for the fallback.",
    );
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + TOKEN_TTL_SECONDS;

  const token = await new SignJWT({ role: "authenticated", app_role: role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuer(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));

  return { token, expiresAt };
}
