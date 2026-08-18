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
