"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * The browser client every read and mutation goes through.
 *
 * `accessToken` is called per request, so the current impersonation token is
 * always attached and PostgREST sees a real, verified identity. Supplying it
 * disables the `auth` namespace, which suits us: the brief forbids Supabase
 * Email Auth and we implement none.
 */
let client: SupabaseClient | null = null;
let currentToken: string | null = null;

export function setSessionToken(token: string | null) {
  currentToken = token;
}

export function getSupabaseBrowserClient(): SupabaseClient {
  client ??= createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { accessToken: async () => currentToken },
  );
  return client;
}
