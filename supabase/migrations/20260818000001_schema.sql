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
