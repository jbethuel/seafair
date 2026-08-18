-- Seafair — make RLS evaluate once per statement, not once per row.
--
-- The original policies called app.has_vessel_access(work_orders.vessel_id).
-- Passing a column makes the call *correlated*, so Postgres cannot hoist it
-- into an InitPlan the way it does for the zero-argument helpers, and EXPLAIN
-- showed it running once per candidate row (loops=715, 2863 shared buffers,
-- 91ms of a 25-row page).
--
-- The fix is to make the membership test uncorrelated: resolve the caller's
-- reachable ids ONCE into an array, then test rows against it with = any().
-- The coalesce() matters syntactically as well as for null safety: a bare
-- `any ((select ...))` is parsed as ANY(subquery), which would compare a uuid
-- against a uuid[]. Wrapping it keeps it an array expression, and an
-- uncorrelated scalar subquery is still hoisted into a single InitPlan.

create or replace function app.accessible_vessel_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select case
    when app.is_admin()
      then (select coalesce(array_agg(v.id), '{}'::uuid[]) from public.vessels v)
    else (
      select coalesce(array_agg(va.vessel_id), '{}'::uuid[])
      from public.vessel_assignments va
      where va.user_id = app.current_user_id()
    )
  end;
$$;

-- Everyone the caller may see: themselves, plus anyone aboard a shared vessel.
create or replace function app.visible_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select case
    when app.is_admin()
      then (select coalesce(array_agg(u.id), '{}'::uuid[]) from public.users u)
    else (
      select coalesce(array_agg(distinct shipmate.user_id), '{}'::uuid[])
      from public.vessel_assignments mine
      join public.vessel_assignments shipmate on shipmate.vessel_id = mine.vessel_id
      where mine.user_id = app.current_user_id()
    )
  end;
$$;

grant execute on function app.accessible_vessel_ids() to authenticated;
grant execute on function app.visible_user_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Re-declare the affected policies against the uncorrelated helpers
-- ---------------------------------------------------------------------------

drop policy users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (
    id = (select app.current_user_id())
    or id = any (coalesce((select app.visible_user_ids()), '{}'::uuid[]))
  );

drop policy vessels_select on public.vessels;
create policy vessels_select on public.vessels
  for select to authenticated
  using (id = any (coalesce((select app.accessible_vessel_ids()), '{}'::uuid[])));

drop policy vessel_assignments_select on public.vessel_assignments;
create policy vessel_assignments_select on public.vessel_assignments
  for select to authenticated
  using (
    user_id = (select app.current_user_id())
    or vessel_id = any (coalesce((select app.accessible_vessel_ids()), '{}'::uuid[]))
  );

drop policy work_orders_select on public.work_orders;
create policy work_orders_select on public.work_orders
  for select to authenticated
  using (
    case (select app.current_role())
      when 'admin'   then true
      when 'captain' then vessel_id = any (coalesce((select app.accessible_vessel_ids()), '{}'::uuid[]))
      when 'crew'    then assignee_id = (select app.current_user_id())
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- Index for the default list ordering
--
-- work_orders_vessel_status_created_idx leads with (vessel_id, status), so a
-- query filtering only on vessel_id cannot use it to satisfy the ORDER BY and
-- has to sort every matching row to return 25. This index serves the unfiltered
-- vessel view directly; the status-filtered one still uses the original.
-- ---------------------------------------------------------------------------

create index work_orders_vessel_created_idx
  on public.work_orders (vessel_id, created_at desc, id desc);

-- The crew's own list, ordered the same way.
create index work_orders_assignee_created_idx
  on public.work_orders (assignee_id, created_at desc, id desc);

analyze public.work_orders;
analyze public.vessel_assignments;
analyze public.users;
