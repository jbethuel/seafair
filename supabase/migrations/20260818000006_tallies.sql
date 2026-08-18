-- Seafair — dashboard tallies in one round trip.
--
-- The dashboard shows five counts. Issuing five queries would be five network
-- round trips and five RLS evaluations; this is one of each. SECURITY INVOKER,
-- so the caller's row level security still decides what is counted — a crew
-- member's tallies cover only their own work.

create or replace function public.work_order_tallies(p_vessel_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'open',                 count(*) filter (where status = 'open'),
    'in_progress',          count(*) filter (where status = 'in_progress'),
    'done',                 count(*) filter (where status = 'done'),
    'awaiting_attestation', count(*) filter (where status = 'done' and attested_at is null),
    'closed',               count(*) filter (where is_closed),
    'total',                count(*)
  )
  from public.work_orders wo
  where p_vessel_id is null or wo.vessel_id = p_vessel_id;
$$;

revoke all on function public.work_order_tallies(uuid) from public, anon;
grant execute on function public.work_order_tallies(uuid) to authenticated;
