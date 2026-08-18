-- Seafair — pluralise the guard messages.
--
-- These strings are what a person actually reads when the database refuses an
-- action, so "1 open work order(s)" is not good enough. Replaces the two
-- functions that count things; the rules themselves are unchanged.

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

  if leaves_crew_duty and old.role = 'crew' then
    open_count := app.open_work_count_for_assignee(old.id);
    if open_count > 0 then
      raise exception using
        errcode = 'SF001',
        message = format(
          '%s still has %s open work order%s assigned. Reassign or close %s first.',
          old.full_name, open_count,
          case when open_count = 1 then '' else 's' end,
          case when open_count = 1 then 'it' else 'them' end
        );
    end if;
  end if;

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
          '%s still has %s open work order%s aboard %s. Reassign or close %s before removing the assignment.',
          subject.full_name, open_count,
          case when open_count = 1 then '' else 's' end,
          vessel.name,
          case when open_count = 1 then 'it' else 'them' end
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
