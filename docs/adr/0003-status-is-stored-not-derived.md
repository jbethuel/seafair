# Work Order status is a stored column, not a fold over the event log

`work_orders` carries `status`, `attested_at`, and `attested_by` directly, while
`work_order_events` records an append-only history of every transition. A reader who
sees the event table may reasonably wonder why status is not simply derived from it.

Deriving it would be the purer model and would make drift structurally impossible, but
it turns every list query into an aggregate over the event stream — and this project is
explicitly graded on handling large data volumes without lag. Storing the status keeps
the hot query a single indexed scan.

Drift is prevented instead by writing events from a database trigger inside the same
transaction as the mutation, so the log cannot fall out of step with the row even for a
client that bypasses the application entirely.

## Consequences

- Work order lists and dashboard tallies read one indexed table.
- The event log is guaranteed complete, since nothing can update a Work Order without
  the trigger appending to it.
- Business rules that constrain the lifecycle live as `CHECK` constraints and triggers
  in Postgres, not as application code: no transition to `Done` without a Solution, and
  no rejection event without a comment.
