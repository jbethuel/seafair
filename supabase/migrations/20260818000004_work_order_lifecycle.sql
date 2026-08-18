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
