# Work Order status is a stored column, not a fold over the event log

`work_orders` carries `status`, `attested_at`, and `attested_by` directly, while
`work_order_events` records an append-only history of every transition. A reader who
sees the event table may reasonably wonder why status is not simply derived from it.

Deriving it would be the purer model and would make drift structurally impossible, but
it turns every list query into an aggregate over the event stream — and this project is
explicitly graded on handling large data volumes without lag. Storing the status keeps
the hot query a single indexed scan.

Drift is prevented instead by making the lifecycle functions the only write path: no
role holds INSERT, UPDATE, or DELETE on `work_orders`, so every mutation necessarily
runs through a function that appends its event in the same transaction. There is no
way to change a work order without logging it, because there is no way to change one
at all except through those functions.

## Consequences

- Work order lists and dashboard tallies read one indexed table.
- The event log is guaranteed complete, since the only write path appends to it.
- Business rules that constrain the lifecycle live as `CHECK` constraints and triggers
  in Postgres, not as application code: no transition to `Done` without a Solution, and
  no rejection event without a comment.
- Transition legality is a trigger rather than a branch inside each function, so it
  still holds against `service_role`, the seed script, and any future migration.
