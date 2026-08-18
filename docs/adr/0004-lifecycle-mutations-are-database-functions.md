# Work order mutations are database functions, not table writes

No role holds INSERT, UPDATE, or DELETE on `work_orders`. Every lifecycle operation —
create, start, save solution, complete, attest, reject, reassign — is a
`SECURITY DEFINER` function in `public`, called from the browser via `supabase.rpc()`.

Row level security constrains *rows*, but the rules here constrain *columns*: crew may
write `solution` and `status` yet must never touch `assignee_id` or `attested_at`, and a
captain is the reverse. A single blanket `UPDATE` grant cannot express that, so policies
alone would have left the column rules to client-side good manners.

The required rejection reason settled it. That comment belongs in `work_order_events`,
and a browser issuing `update({ status: 'in_progress' })` has nowhere to put it — a
trigger cannot record a value the client never sent. As a function parameter it simply
goes where it belongs.

## Consequences

- Reads stay governed by RLS; writes are governed by functions. The README's policy
  matrix states this split plainly rather than implying RLS covers everything.
- Authority checks inside the functions call the same `app.*` helpers the read policies
  use, so "captain of this vessel" has one definition in the system, not two.
- Mutations remain browser-side calls, as the brief prefers. `rpc()` is a PostgREST
  call like any other.
- Transition legality stays a trigger, not function logic, so it also binds
  `service_role` and the seed script.
