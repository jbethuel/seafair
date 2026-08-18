-- Seafair — complete database schema.
--
-- GENERATED FILE. Built from supabase/migrations by `pnpm db:schema`.
-- Edit the migrations, not this file.
--
-- Applying this to an empty Postgres reproduces the database exactly, provided
-- the anon, authenticated and service_role roles exist (Supabase creates them).


-- ==========================================================================
-- 20260818000001_schema.sql
-- ==========================================================================

-- Seafair — core schema.
--
-- Vocabulary here follows CONTEXT.md exactly:
--   Assignment  = user aboard a vessel        -> vessel_assignments
--   Assignee    = crew responsible for a work order -> work_orders.assignee_id
-- Those are different relations; do not conflate them.

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

create type app.user_role as enum ('admin', 'captain', 'crew');

-- Strictly the three statuses the brief allows. Review state is NOT a status;
-- it lives on attested_at / attested_by. See docs/adr/0003.
create type app.work_order_status as enum ('open', 'in_progress', 'done');

create type app.work_order_event_type as enum (
  'created',
  'assigned',
  'reassigned',
  'status_changed',
  'solution_updated',
  'submitted_for_review',
  'attested',
  'rejected'
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create table public.users (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text not null,
  role        app.user_role not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint users_full_name_not_blank check (length(btrim(full_name)) > 0),
  constraint users_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- Duplicate prevention spans deactivated rows deliberately: the remedy for
-- "we want that identity back" is reactivation, never a second record.
create unique index users_email_key on public.users (lower(email));
create index users_role_active_idx on public.users (role, is_active);

-- ---------------------------------------------------------------------------
-- Vessels
-- ---------------------------------------------------------------------------

create table public.vessels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  imo_number  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint vessels_name_not_blank check (length(btrim(name)) > 0),
  -- IMO numbers are exactly seven digits.
  constraint vessels_imo_shape check (imo_number is null or imo_number ~ '^[0-9]{7}$')
);

create unique index vessels_name_key on public.vessels (lower(name));
create unique index vessels_imo_number_key on public.vessels (imo_number)
  where imo_number is not null;
create index vessels_active_idx on public.vessels (is_active);

-- ---------------------------------------------------------------------------
-- Assignments (user aboard vessel)
-- ---------------------------------------------------------------------------

create table public.vessel_assignments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  vessel_id   uuid not null references public.vessels (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint vessel_assignments_unique unique (user_id, vessel_id)
);

create index vessel_assignments_user_idx on public.vessel_assignments (user_id);
create index vessel_assignments_vessel_idx on public.vessel_assignments (vessel_id);

-- ---------------------------------------------------------------------------
-- Work orders
-- ---------------------------------------------------------------------------

create sequence app.work_order_reference_seq;

create table public.work_orders (
  id           uuid primary key default gen_random_uuid(),
  reference    text not null default 'WO-' || lpad(nextval('app.work_order_reference_seq')::text, 6, '0'),
  vessel_id    uuid not null references public.vessels (id) on delete restrict,
  title        text not null,
  issue        text not null,
  solution     text,
  status       app.work_order_status not null default 'open',
  created_by   uuid not null references public.users (id) on delete restrict,
  assignee_id  uuid not null references public.users (id) on delete restrict,
  attested_at  timestamptz,
  attested_by  uuid references public.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Closed is the only terminal condition: Done AND attested.
  -- Stored so the deactivation guards and list filters hit an index.
  is_closed boolean generated always as (
    status = 'done' and attested_at is not null
  ) stored,

  constraint work_orders_title_not_blank check (length(btrim(title)) > 0),
  constraint work_orders_issue_not_blank check (length(btrim(issue)) > 0),

  -- A Work Order cannot reach Done without a Solution. Enforced here rather
  -- than in a form, so it holds for any client.
  constraint work_orders_done_requires_solution check (
    status <> 'done' or (solution is not null and length(btrim(solution)) > 0)
  ),

  -- Attestation only applies to Done work, and both columns move together.
  constraint work_orders_attested_only_when_done check (
    attested_at is null or status = 'done'
  ),
  constraint work_orders_attestation_paired check (
    (attested_at is null) = (attested_by is null)
  )
);

create unique index work_orders_reference_key on public.work_orders (reference);

-- Primary list query: work orders for a vessel, filtered by status,
-- newest first (cursor pagination on (created_at, id)).
create index work_orders_vessel_status_created_idx
  on public.work_orders (vessel_id, status, created_at desc, id desc);

-- Crew's "my work" view.
create index work_orders_assignee_status_idx
  on public.work_orders (assignee_id, status);

-- The predicate every deactivation guard runs.
create index work_orders_open_assignee_idx
  on public.work_orders (assignee_id) where not is_closed;
create index work_orders_open_vessel_idx
  on public.work_orders (vessel_id) where not is_closed;

-- Captain's review queue: Done but not yet attested.
create index work_orders_awaiting_attestation_idx
  on public.work_orders (vessel_id, created_at desc)
  where status = 'done' and attested_at is null;

-- ---------------------------------------------------------------------------
-- Work order events (append-only history)
-- ---------------------------------------------------------------------------

create table public.work_order_events (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  actor_id       uuid references public.users (id) on delete set null,
  type           app.work_order_event_type not null,
  from_status    app.work_order_status,
  to_status      app.work_order_status,
  comment        text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),

  -- The brief's "required rejection reason", enforced by the database.
  constraint work_order_events_rejection_requires_comment check (
    type <> 'rejected' or (comment is not null and length(btrim(comment)) > 0)
  )
);

create index work_order_events_work_order_idx
  on public.work_order_events (work_order_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function app.touch_updated_at();

create trigger vessels_touch_updated_at
  before update on public.vessels
  for each row execute function app.touch_updated_at();

create trigger work_orders_touch_updated_at
  before update on public.work_orders
  for each row execute function app.touch_updated_at();


-- ==========================================================================
-- 20260818000002_identity_and_guards.sql
-- ==========================================================================

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


-- ==========================================================================
-- 20260818000003_rls.sql
-- ==========================================================================

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


-- ==========================================================================
-- 20260818000004_work_order_lifecycle.sql
-- ==========================================================================

-- Seafair — the work order lifecycle.
--
-- These functions are the only write path to work_orders (no role holds
-- INSERT/UPDATE/DELETE on the table). Each one answers three questions in the
-- same transaction: may this actor do this, is this transition legal, and what
-- goes in the history.
--
-- They are SECURITY DEFINER because the caller has no write privilege of their
-- own; authority is therefore checked explicitly here, using the same app.*
-- helpers the RLS read policies use, so there is one definition of "captain of
-- this vessel" in the system rather than two.

-- ---------------------------------------------------------------------------
-- Transition legality — independent of who is calling
--
-- Holds even against service_role and future migrations, which is why it is a
-- trigger rather than a branch inside each function.
-- ---------------------------------------------------------------------------

create or replace function app.guard_work_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  -- A Closed work order is frozen. Attestation is the end of the line.
  if old.is_closed then
    raise exception using
      errcode = 'SF020',
      message = format('%s is closed and can no longer be modified.', old.reference);
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'open'        and new.status = 'in_progress') or
      (old.status = 'in_progress' and new.status = 'done')        or
      -- Rejection returns Done work to the assignee.
      (old.status = 'done'        and new.status = 'in_progress')
    ) then
      raise exception using
        errcode = 'SF021',
        message = format('%s cannot move from %s to %s.', old.reference, old.status, new.status);
    end if;
  end if;

  -- Attestation is never withdrawn, and never applies to work that is not Done.
  if old.attested_at is not null and new.attested_at is null then
    raise exception using
      errcode = 'SF022',
      message = format('Attestation on %s cannot be withdrawn.', old.reference);
  end if;

  -- Neither the vessel nor the raising captain is rewritable.
  if new.vessel_id is distinct from old.vessel_id then
    raise exception using
      errcode = 'SF023',
      message = 'A work order cannot be moved between vessels.';
  end if;

  return new;
end;
$$;

create trigger work_orders_guard_transition
  before update on public.work_orders
  for each row execute function app.guard_work_order_transition();

-- ---------------------------------------------------------------------------
-- Shared authority assertions
-- ---------------------------------------------------------------------------

create or replace function app.require_actor()
returns public.users
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  actor public.users;
begin
  select * into actor from public.users where id = app.current_user_id();

  if actor.id is null then
    raise exception using errcode = 'SF010', message = 'No active session.';
  end if;
  if not actor.is_active then
    raise exception using errcode = 'SF011', message = 'This account is deactivated.';
  end if;

  return actor;
end;
$$;

-- The captain who may act on a given work order: assigned to its vessel, and
-- actually a captain. Admins are deliberately not accepted here (docs/adr/0002).
create or replace function app.require_captain_of(target_vessel_id uuid)
returns public.users
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  actor public.users := app.require_actor();
begin
  if actor.role <> 'captain' then
    raise exception using
      errcode = 'SF012',
      message = 'Only captains may raise, attest, or reject work orders.';
  end if;

  if not exists (
    select 1 from public.vessel_assignments va
    where va.user_id = actor.id and va.vessel_id = target_vessel_id
  ) then
    raise exception using
      errcode = 'SF013',
      message = 'You are not assigned to this vessel.';
  end if;

  return actor;
end;
$$;

-- ---------------------------------------------------------------------------
-- Captain: raise a work order
-- ---------------------------------------------------------------------------

create or replace function public.create_work_order(
  p_vessel_id   uuid,
  p_title       text,
  p_issue       text,
  p_assignee_id uuid
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  actor    public.users := app.require_captain_of(p_vessel_id);
  assignee public.users;
  vessel   public.vessels;
  created  public.work_orders;
begin
  select * into vessel from public.vessels where id = p_vessel_id;
  if not vessel.is_active then
    raise exception using errcode = 'SF014', message = 'This vessel is deactivated.';
  end if;

  select * into assignee from public.users where id = p_assignee_id;

  if assignee.id is null or not assignee.is_active then
    raise exception using errcode = 'SF015', message = 'That crew member is not available.';
  end if;
  if assignee.role <> 'crew' then
    raise exception using errcode = 'SF016', message = 'Work orders may only be assigned to crew.';
  end if;
  if not exists (
    select 1 from public.vessel_assignments va
    where va.user_id = assignee.id and va.vessel_id = p_vessel_id
  ) then
    raise exception using
      errcode = 'SF017',
      message = format('%s is not assigned to %s.', assignee.full_name, vessel.name);
  end if;

  insert into public.work_orders (vessel_id, title, issue, status, created_by, assignee_id)
  values (p_vessel_id, btrim(p_title), btrim(p_issue), 'open', actor.id, assignee.id)
  returning * into created;

  insert into public.work_order_events (work_order_id, actor_id, type, to_status, metadata)
  values (created.id, actor.id, 'created', 'open',
          jsonb_build_object('assignee_id', assignee.id, 'assignee_name', assignee.full_name));

  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Crew: start work
-- ---------------------------------------------------------------------------

create or replace function public.start_work_order(p_work_order_id uuid)
returns public.work_orders
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  actor   public.users := app.require_actor();
  wo      public.work_orders;
  updated public.work_orders;
begin
  select * into wo from public.work_orders where id = p_work_order_id;
  if wo.id is null then
    raise exception using errcode = 'SF018', message = 'Work order not found.';
  end if;
  if wo.assignee_id <> actor.id then
    raise exception using errcode = 'SF019', message = 'Only the assigned crew member may start this work.';
  end if;
  if wo.status <> 'open' then
    raise exception using
      errcode = 'SF028',
      message = format('%s is already under way.', wo.reference);
  end if;

  update public.work_orders
     set status = 'in_progress'
   where id = wo.id
   returning * into updated;

  insert into public.work_order_events (work_order_id, actor_id, type, from_status, to_status)
  values (wo.id, actor.id, 'status_changed', wo.status, 'in_progress');

  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- Crew: record the solution without submitting it
-- ---------------------------------------------------------------------------

create or replace function public.save_solution(p_work_order_id uuid, p_solution text)
returns public.work_orders
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  actor   public.users := app.require_actor();
  wo      public.work_orders;
  updated public.work_orders;
begin
  select * into wo from public.work_orders where id = p_work_order_id;
  if wo.id is null then
    raise exception using errcode = 'SF018', message = 'Work order not found.';
  end if;
  if wo.assignee_id <> actor.id then
    raise exception using errcode = 'SF019', message = 'Only the assigned crew member may document this work.';
  end if;
  if wo.status = 'done' then
    raise exception using
      errcode = 'SF029',
      message = format('%s is with the captain for review and cannot be edited.', wo.reference);
  end if;

  update public.work_orders
     set solution = nullif(btrim(p_solution), '')
   where id = wo.id
   returning * into updated;

  insert into public.work_order_events (work_order_id, actor_id, type)
  values (wo.id, actor.id, 'solution_updated');

  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- Crew: mark as done and hand it to the captain for review
-- ---------------------------------------------------------------------------

create or replace function public.complete_work_order(
  p_work_order_id uuid,
  p_solution      text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  actor    public.users := app.require_actor();
  wo       public.work_orders;
  updated    public.work_orders;
  v_solution text;
begin
  select * into wo from public.work_orders where id = p_work_order_id;
  if wo.id is null then
    raise exception using errcode = 'SF018', message = 'Work order not found.';
  end if;
  if wo.assignee_id <> actor.id then
    raise exception using errcode = 'SF019', message = 'Only the assigned crew member may complete this work.';
  end if;

  v_solution := coalesce(nullif(btrim(p_solution), ''), wo.solution);
  if v_solution is null then
    raise exception using
      errcode = 'SF024',
      message = 'Document the solution before marking this work order done.';
  end if;

  update public.work_orders
     set solution = v_solution, status = 'done'
   where id = wo.id
   returning * into updated;

  insert into public.work_order_events (work_order_id, actor_id, type, from_status, to_status)
  values (wo.id, actor.id, 'submitted_for_review', wo.status, 'done');

  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- Captain: attest — the only terminal action
-- ---------------------------------------------------------------------------

create or replace function public.attest_work_order(p_work_order_id uuid)
returns public.work_orders
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  wo      public.work_orders;
  actor   public.users;
  updated public.work_orders;
begin
  select * into wo from public.work_orders where id = p_work_order_id;
  if wo.id is null then
    raise exception using errcode = 'SF018', message = 'Work order not found.';
  end if;

  actor := app.require_captain_of(wo.vessel_id);

  if wo.status <> 'done' then
    raise exception using
      errcode = 'SF025',
      message = 'Only work orders marked done can be attested.';
  end if;

  update public.work_orders
     set attested_at = now(), attested_by = actor.id
   where id = wo.id
   returning * into updated;

  insert into public.work_order_events (work_order_id, actor_id, type, from_status, to_status)
  values (wo.id, actor.id, 'attested', 'done', 'done');

  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- Captain: reject — the reason is a parameter, which is why this is a function
-- and not a table update
-- ---------------------------------------------------------------------------

create or replace function public.reject_work_order(
  p_work_order_id uuid,
  p_reason        text
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  wo      public.work_orders;
  actor   public.users;
  updated public.work_orders;
  reason  text := nullif(btrim(p_reason), '');
begin
  select * into wo from public.work_orders where id = p_work_order_id;
  if wo.id is null then
    raise exception using errcode = 'SF018', message = 'Work order not found.';
  end if;

  actor := app.require_captain_of(wo.vessel_id);

  if wo.status <> 'done' then
    raise exception using
      errcode = 'SF025',
      message = 'Only work orders marked done can be rejected.';
  end if;
  if reason is null then
    raise exception using
      errcode = 'SF026',
      message = 'A rejection must say what needs putting right.';
  end if;

  update public.work_orders
     set status = 'in_progress'
   where id = wo.id
   returning * into updated;

  insert into public.work_order_events
    (work_order_id, actor_id, type, from_status, to_status, comment)
  values (wo.id, actor.id, 'rejected', 'done', 'in_progress', reason);

  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- Captain or Admin: reassign
--
-- The one lifecycle verb admins hold, and the remedy that stops a deactivation
-- from ever stranding a work order (docs/adr/0002).
-- ---------------------------------------------------------------------------

create or replace function public.reassign_work_order(
  p_work_order_id  uuid,
  p_new_assignee_id uuid
)
returns public.work_orders
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  actor       public.users := app.require_actor();
  wo          public.work_orders;
  assignee    public.users;
  previous    public.users;
  updated     public.work_orders;
begin
  select * into wo from public.work_orders where id = p_work_order_id;
  if wo.id is null then
    raise exception using errcode = 'SF018', message = 'Work order not found.';
  end if;

  if actor.role = 'captain' then
    perform app.require_captain_of(wo.vessel_id);
  elsif actor.role <> 'admin' then
    raise exception using
      errcode = 'SF027',
      message = 'Only a captain of this vessel, or an admin, may reassign work.';
  end if;

  select * into assignee from public.users where id = p_new_assignee_id;
  if assignee.id is null or not assignee.is_active then
    raise exception using errcode = 'SF015', message = 'That crew member is not available.';
  end if;
  if assignee.role <> 'crew' then
    raise exception using errcode = 'SF016', message = 'Work orders may only be assigned to crew.';
  end if;
  if not exists (
    select 1 from public.vessel_assignments va
    where va.user_id = assignee.id and va.vessel_id = wo.vessel_id
  ) then
    raise exception using
      errcode = 'SF017',
      message = 'That crew member is not assigned to this vessel.';
  end if;

  select * into previous from public.users where id = wo.assignee_id;

  update public.work_orders
     set assignee_id = assignee.id
   where id = wo.id
   returning * into updated;

  insert into public.work_order_events (work_order_id, actor_id, type, metadata)
  values (wo.id, actor.id, 'reassigned',
          jsonb_build_object(
            'from_user_id', previous.id, 'from_name', previous.full_name,
            'to_user_id', assignee.id,   'to_name', assignee.full_name
          ));

  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges: authenticated only. anon calls nothing.
-- ---------------------------------------------------------------------------

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.create_work_order(uuid, text, text, uuid)',
    'public.start_work_order(uuid)',
    'public.save_solution(uuid, text)',
    'public.complete_work_order(uuid, text)',
    'public.attest_work_order(uuid)',
    'public.reject_work_order(uuid, text)',
    'public.reassign_work_order(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;


-- ==========================================================================
-- 20260818000005_rls_performance.sql
-- ==========================================================================

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


-- ==========================================================================
-- 20260818000006_tallies.sql
-- ==========================================================================

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


-- ==========================================================================
-- 20260818000007_service_role_grants.sql
-- ==========================================================================

-- Seafair — restore the privileges that dropping the public schema discards.
--
-- Supabase grants service_role access to public via ALTER DEFAULT PRIVILEGES,
-- which is attached to the schema. `db:reset` drops and recreates public, so
-- those defaults go with it and every subsequently created table is invisible
-- to service_role — which surfaces as "permission denied for table vessels"
-- from the roster route, with nothing wrong in the policies at all.
--
-- service_role bypasses RLS, but bypassing RLS is not the same as holding a
-- table privilege; it still needs the GRANT.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all routines in schema public to service_role;

grant usage on schema app to service_role;
grant all privileges on all routines in schema app to service_role;
grant all privileges on all sequences in schema app to service_role;

-- And for anything added later.
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant all privileges on routines to service_role;

-- The anon role stays at zero. Re-asserted here because recreating the schema
-- also reinstates Supabase's default grant to anon, which we do not want.
revoke all on all tables in schema public from anon;
revoke all on all routines in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on routines from anon;
