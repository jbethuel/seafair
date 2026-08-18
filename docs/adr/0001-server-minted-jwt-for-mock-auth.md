# Server-minted JWTs carry the mock session, so RLS does the real enforcement

The assessment asks for browser-client-side Supabase reads and writes, forbids
Supabase Email Auth, and grades database security on "RLS policies… proper
authorization checks." Those pull against each other: a browser client with only the
public anon key has no `auth.uid()`, so every RLS policy degenerates to `USING (true)`
— which grants the whole database to anyone holding a key that is, by design, public.

We resolve it by minting our own session token. A single route handler
(`POST /api/session`) accepts a User id, confirms that User is active, and signs a
short-lived JWT carrying `sub` and the Role claim. The browser client attaches it via
supabase-js's `accessToken` option, so `auth.uid()` and the Role claim are real inside
Postgres and RLS performs the actual authorization — vessel scoping, role permissions,
and the deactivation guards — while every read and write still travels
browser → Supabase as the assessment prefers.

Impersonation is deliberately unauthenticated: that *is* the mock auth we were asked
to build. The distinction that matters is that the mock stops at *identity*, and every
question of *authority* is answered by the database.

## Considered options

- **Anon key with permissive RLS, permissions enforced in React.** Rejected: the anon
  key is public, so the client-side checks are advisory and the REST API is wide open
  to anyone with curl.
- **Browser reads, all mutations through server route handlers using service-role.**
  Rejected: disobeys the stated preference for browser-side mutations, and
  service-role bypasses RLS, so the policies would still be decorative.

## Consequences

- The service-role key and the JWT signing secret live only on the server; neither is
  ever shipped to the browser.
- Authorization logic lives in SQL, not TypeScript. Client-side permission checks exist
  only to hide controls the user cannot use, and are never the enforcement point.
- The token carries identity and Role, never a list of Vessels. Vessel access is
  derived from Assignments at query time, so revoking an Assignment takes effect
  immediately rather than at token expiry.
- Verified against the live project rather than assumed. `scripts/verify-jwt.mts`
  mints a token, calls the REST API, and asserts three things: the gateway accepts a
  token we signed ourselves, RLS resolves `auth.uid()` from it, and a member of another
  vessel receives an empty result rather than someone else's work. The anon key alone
  returns 401, confirming the public role holds no privilege. Re-run it after any change
  to the project's JWT settings.
- This depends on the project's legacy symmetric JWT secret, which Supabase deprecates
  at the end of 2026. Should it be withdrawn, the fallback is to verify the same token
  inside Postgres via a `SECURITY DEFINER` function using `pgcrypto.hmac()` with the
  secret held in Vault. Only `app.current_user_id()` would change; no policy moves.
