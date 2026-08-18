-- Seafair — acting identity, plus the deactivation and unassignment guards.
--
-- Every guard is a trigger rather than application code. Under the mock-auth
-- design (docs/adr/0001) the browser holds a real token and talks straight to
-- PostgREST, so a client-side check is advice and only the database can refuse.

-- ---------------------------------------------------------------------------
-- Acting identity
--
-- app.current_user_id() is the single seam between the token format and every
-- policy in the system. Under the gateway-verified path it reads the verified
-- `sub` claim. If the project cannot honour a self-signed token, only this one
-- function changes (to verify an HMAC over the raw header); no policy moves.
--
-- Note what is deliberately NOT read from the token: the user's role, and the
-- vessels they may reach. Both are looked up live, so revoking an Assignment or
-- changing a Role takes effect on the next query rather than at token expiry.
-- ---------------------------------------------------------------------------

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

-- SECURITY DEFINER so policies on public.users cannot recurse into themselves.
-- STABLE so Postgres evaluates it once per statement, not once per row — the
-- single most common cause of slow RLS.
create or replace function app.current_role()
returns app.user_role
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.role
  from public.users u
  where u.id = app.current_user_id()
    and u.is_active;
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.current_role() = 'admin';
$$;

-- Admins hold no Assignments; their reach is global. Everyone else must have a
-- row in vessel_assignments. Keeping that exception here means no policy has to
-- restate it.
create or replace function app.has_vessel_access(target_vessel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.is_admin()
      or exists (
        select 1
        from public.vessel_assignments va
        where va.vessel_id = target_vessel_id
          and va.user_id = app.current_user_id()
      );
$$;

-- ---------------------------------------------------------------------------
-- Guard helpers
-- ---------------------------------------------------------------------------

-- Open Work: any work order that is not Closed. Uses the stored generated
-- column, so these all hit the partial indexes.
create or replace function app.open_work_count_for_assignee(target_user_id uuid, target_vessel_id uuid default null)
returns bigint
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select count(*)
  from public.work_orders wo
  where wo.assignee_id = target_user_id
    and not wo.is_closed
    and (target_vessel_id is null or wo.vessel_id = target_vessel_id);
$$;

create or replace function app.vessel_has_open_work(target_vessel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.work_orders wo
    where wo.vessel_id = target_vessel_id
      and not wo.is_closed
  );
$$;

-- Active captains aboard a vessel, optionally ignoring one user (the one being
-- deactivated, demoted, or unassigned).
create or replace function app.active_captain_count(target_vessel_id uuid, excluding_user_id uuid default null)
returns bigint
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select count(*)
  from public.vessel_assignments va
  join public.users u on u.id = va.user_id
  where va.vessel_id = target_vessel_id
    and u.role = 'captain'
    and u.is_active
    and (excluding_user_id is null or u.id <> excluding_user_id);
$$;

-- ---------------------------------------------------------------------------
-- R1 / R2 / R3 / R6 — users
--
-- Deactivation and role change are the same hazard wearing different hats, so
-- one trigger handles both.
-- ---------------------------------------------------------------------------

create or replace function app.guard_user_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  is_deactivating boolean := old.is_active and not new.is_active;
  is_role_change  boolean := old.role is distinct from new.role;
  leaves_crew_duty boolean := is_deactivating or (is_role_change and old.role = 'crew');
  leaves_captain_duty boolean := is_deactivating or (is_role_change and old.role = 'captain');
  offending record;
  open_count bigint;
begin
  if not (is_deactivating or is_role_change) then
    return new;
  end if;

  -- R1 (deactivate) / R6 (role change): a Crew user must not walk away from
  -- Open Work they are the Assignee of.
  if leaves_crew_duty and old.role = 'crew' then
    open_count := app.open_work_count_for_assignee(old.id);
    if open_count > 0 then
      raise exception using
        errcode = 'SF001',
        message = format(
          '%s still has %s open work order(s) assigned. Reassign or close them first.',
          old.full_name, open_count
        );
    end if;
  end if;

  -- R2 (deactivate) / R6 (role change): a Captain must not be the last active
  -- captain of a vessel that still has Open Work — nobody would be left who
  -- could attest it. Vessels with no open work are fine to leave uncaptained.
  if leaves_captain_duty and old.role = 'captain' then
    select v.name into offending
    from public.vessel_assignments va
    join public.vessels v on v.id = va.vessel_id
    where va.user_id = old.id
      and app.vessel_has_open_work(va.vessel_id)
      and app.active_captain_count(va.vessel_id, old.id) = 0
    limit 1;

    if found then
      raise exception using
        errcode = 'SF002',
        message = format(
          '%s is the only active captain of %s, which has open work orders awaiting attestation. Assign another captain first.',
          old.full_name, offending.name
        );
    end if;
  end if;

  -- R3: never strand the system without an administrator.
  if (is_deactivating or (is_role_change and old.role = 'admin')) and old.role = 'admin' then
    if (
      select count(*) from public.users u
      where u.role = 'admin' and u.is_active and u.id <> old.id
    ) = 0 then
      raise exception using
        errcode = 'SF003',
        message = 'This is the last active admin. Promote another admin before changing this one.';
    end if;
  end if;

  return new;
end;
$$;

create trigger users_guard_change
  before update on public.users
  for each row execute function app.guard_user_change();

-- ---------------------------------------------------------------------------
-- R4 — removing an Assignment is the same hazard as deactivation
-- ---------------------------------------------------------------------------

create or replace function app.guard_assignment_removal()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  subject public.users%rowtype;
  vessel  public.vessels%rowtype;
  open_count bigint;
begin
  select * into subject from public.users where id = old.user_id;

  -- The user row is on its way out too (cascade); nothing left to protect.
  if subject.id is null then
    return old;
  end if;

  select * into vessel from public.vessels where id = old.vessel_id;

  if subject.role = 'crew' then
    open_count := app.open_work_count_for_assignee(old.user_id, old.vessel_id);
    if open_count > 0 then
      raise exception using
        errcode = 'SF004',
        message = format(
          '%s still has %s open work order(s) aboard %s. Reassign or close them before removing the assignment.',
          subject.full_name, open_count, vessel.name
        );
    end if;
  end if;

  if subject.role = 'captain' and subject.is_active then
    if app.vessel_has_open_work(old.vessel_id)
       and app.active_captain_count(old.vessel_id, old.user_id) = 0 then
      raise exception using
        errcode = 'SF005',
        message = format(
          '%s is the only active captain of %s, which has open work orders awaiting attestation. Assign another captain first.',
          subject.full_name, vessel.name
        );
    end if;
  end if;

  return old;
end;
$$;

create trigger vessel_assignments_guard_removal
  before delete on public.vessel_assignments
  for each row execute function app.guard_assignment_removal();

-- ---------------------------------------------------------------------------
-- R5 — vessels
-- ---------------------------------------------------------------------------

create or replace function app.guard_vessel_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if old.is_active and not new.is_active and app.vessel_has_open_work(old.id) then
    raise exception using
      errcode = 'SF006',
      message = format(
        '%s still has open work orders. Close or attest them before deactivating the vessel.',
        old.name
      );
  end if;
  return new;
end;
$$;

create trigger vessels_guard_change
  before update on public.vessels
  for each row execute function app.guard_vessel_change();

-- ---------------------------------------------------------------------------
-- Assignment integrity: only Captains and Crew sail. Admins are global.
-- ---------------------------------------------------------------------------

create or replace function app.guard_assignment_role()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  subject_role app.user_role;
begin
  select role into subject_role from public.users where id = new.user_id;

  if subject_role = 'admin' then
    raise exception using
      errcode = 'SF007',
      message = 'Admins are not assigned to vessels; their access is fleet-wide.';
  end if;

  return new;
end;
$$;

create trigger vessel_assignments_guard_role
  before insert or update on public.vessel_assignments
  for each row execute function app.guard_assignment_role();
