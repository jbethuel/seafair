import { beforeAll, afterAll, expect, test } from "vitest";
import { startHarness, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.stop(); });

test("every migration applies cleanly", async () => {
  const { rows } = await h.root.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  expect(rows.map((r) => r.tablename)).toEqual([
    "users",
    "vessel_assignments",
    "vessels",
    "work_order_events",
    "work_orders",
  ]);
});

test("row level security is enabled on every table", async () => {
  const { rows } = await h.root.query(
    `select relname from pg_class
      where relnamespace = 'public'::regnamespace
        and relkind = 'r' and not relrowsecurity`,
  );
  expect(rows).toEqual([]);
});

test("anon holds no privilege on any table", async () => {
  const { rows } = await h.root.query(
    `select table_name, privilege_type
       from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'`,
  );
  expect(rows).toEqual([]);
});

test("nobody may write work_orders directly", async () => {
  const { rows } = await h.root.query(
    `select grantee, privilege_type
       from information_schema.role_table_grants
      where table_name = 'work_orders'
        and table_schema = 'public'
        and grantee in ('anon', 'authenticated')`,
  );
  expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
});
