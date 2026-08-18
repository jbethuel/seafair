-- Seafair — grants and row level security.
--
-- Two distinct postures, deliberately:
--
--   Fleet administration (users, vessels, vessel_assignments) is plain
--   row-level CRUD, so RLS expresses it directly: admins write, nobody else.
--
--   The work order lifecycle is NOT expressible as row-level policy, because
--   RLS constrains rows and the rules here constrain *columns* (crew may write
--   solution but never assignee_id or attested_at). So writes are granted to
--   nobody and travel through vetted functions instead — see migration 0004.
--
-- The anon role holds no privilege on anything. The utility bar's roster is
-- served by a server route, not by a public table grant.

-- ---------------------------------------------------------------------------
-- Baseline: revoke everything, then grant back deliberately
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all routines in schema public from anon, authenticated;
revoke all on schema app from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Reads for signed-in members; every one of them filtered by RLS below.
grant select on public.users, public.vessels, public.vessel_assignments,
                public.work_orders, public.work_order_events
  to authenticated;

-- Fleet administration is row-level, so the grant is real and RLS narrows it.
grant insert, update on public.users to authenticated;
grant insert, update on public.vessels to authenticated;
grant insert, delete on public.vessel_assignments to authenticated;

-- Deliberately absent: any write grant on work_orders or work_order_events.

-- ---------------------------------------------------------------------------
-- Helper: do I share a vessel with this person?
-- ---------------------------------------------------------------------------

create or replace function app.shares_vessel_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.vessel_assignments mine
    join public.vessel_assignments theirs on theirs.vessel_id = mine.vessel_id
    where mine.user_id = app.current_user_id()
      and theirs.user_id = target_user_id
  );
$$;

grant execute on function app.current_user_id() to authenticated;
grant execute on function app.current_role() to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.has_vessel_access(uuid) to authenticated;
grant execute on function app.shares_vessel_with(uuid) to authenticated;
grant usage on schema app to authenticated;

alter table public.users               enable row level security;
alter table public.vessels             enable row level security;
alter table public.vessel_assignments  enable row level security;
alter table public.work_orders         enable row level security;
alter table public.work_order_events   enable row level security;

-- Deliberately NOT forcing RLS on the owner. The helper functions above are
-- SECURITY DEFINER precisely so that a policy on users may ask "is the caller an
-- admin?" without re-entering users_select and recursing forever. FORCE would
-- close that escape hatch and deadlock the policy set.

-- ---------------------------------------------------------------------------
-- users
--
-- Every policy wraps helper calls in (select ...) so Postgres evaluates them
-- once per statement rather than once per row. This is the difference between
-- a fast list view and a slow one.
-- ---------------------------------------------------------------------------

create policy users_select on public.users
  for select to authenticated
  using (
    (select app.is_admin())
    or id = (select app.current_user_id())
    or (select app.shares_vessel_with(users.id))
  );

create policy users_insert on public.users
  for insert to authenticated
  with check ((select app.is_admin()));

create policy users_update on public.users
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

-- No delete policy: users are deactivated, never removed.

-- ---------------------------------------------------------------------------
-- vessels
-- ---------------------------------------------------------------------------

create policy vessels_select on public.vessels
  for select to authenticated
  using ((select app.has_vessel_access(vessels.id)));

create policy vessels_insert on public.vessels
  for insert to authenticated
  with check ((select app.is_admin()));

create policy vessels_update on public.vessels
  for update to authenticated
  using ((select app.is_admin()))
  with check ((select app.is_admin()));

-- ---------------------------------------------------------------------------
-- vessel_assignments
-- ---------------------------------------------------------------------------

create policy vessel_assignments_select on public.vessel_assignments
  for select to authenticated
  using (
    (select app.is_admin())
    or user_id = (select app.current_user_id())
    or (select app.has_vessel_access(vessel_assignments.vessel_id))
  );

create policy vessel_assignments_insert on public.vessel_assignments
  for insert to authenticated
  with check ((select app.is_admin()));

create policy vessel_assignments_delete on public.vessel_assignments
  for delete to authenticated
  using ((select app.is_admin()));

-- ---------------------------------------------------------------------------
-- work_orders
--
-- Admins see the fleet. Captains see everything aboard vessels they are
-- assigned to. Crew see only work orders assigned to them — the brief says
-- "crew members can view their assigned work orders", so vessel-wide visibility
-- would be wider than asked for.
-- ---------------------------------------------------------------------------

create policy work_orders_select on public.work_orders
  for select to authenticated
  using (
    (select app.is_admin())
    or (
      (select app.current_role()) = 'captain'
      and (select app.has_vessel_access(work_orders.vessel_id))
    )
    or (
      (select app.current_role()) = 'crew'
      and assignee_id = (select app.current_user_id())
    )
  );

-- No insert/update/delete policy, and no grant. The lifecycle functions in
-- migration 0004 are the only write path.

-- ---------------------------------------------------------------------------
-- work_order_events
--
-- Visibility follows the work order itself: the subquery is executed as the
-- caller, so work_orders_select above filters it automatically and the rule
-- never has to be restated.
-- ---------------------------------------------------------------------------

create policy work_order_events_select on public.work_order_events
  for select to authenticated
  using (
    exists (
      select 1 from public.work_orders wo
      where wo.id = work_order_events.work_order_id
    )
  );
