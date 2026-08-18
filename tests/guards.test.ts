import { beforeAll, afterAll, beforeEach, expect, test } from "vitest";
import { startHarness, type Harness } from "./harness";
import { seedWorld, givenWorkOrder, closeWorkOrder, errcodeOf, messageOf, type World } from "./fixtures";

let h: Harness;
let w: World;

beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.stop(); });
beforeEach(async () => { await h.reset(); w = await seedWorld(h); });

const deactivateUser = (id: string) =>
  h.root.query(`update public.users set is_active = false where id = $1`, [id]);

// --- R1 ---------------------------------------------------------------------

test("R1: crew holding open work cannot be deactivated", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  expect(await errcodeOf(() => deactivateUser(w.crewNS))).toBe("SF001");
});

test("guard messages name the person and read as English", async () => {
  // These strings are what a person actually reads when the database refuses
  // an action, so "1 open work order(s)" is a defect, not a detail.
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });

  const singular = await messageOf(() => deactivateUser(w.crewNS));
  expect(singular).toContain("Tam Oduya");
  expect(singular).toContain("1 open work order assigned");
  expect(singular).not.toContain("(s)");

  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  const plural = await messageOf(() => deactivateUser(w.crewNS));
  expect(plural).toContain("2 open work orders assigned");
});

test("R1: crew whose work is closed can be deactivated", async () => {
  const wo = await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  await closeWorkOrder(h, wo.id, w.captainNS);
  await expect(deactivateUser(w.crewNS)).resolves.toBeDefined();
});

test("R1: work that is Done but unattested still counts as open", async () => {
  const wo = await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  await h.root.query(
    `update public.work_orders set solution = 'Done.', status = 'in_progress' where id = $1`, [wo.id]);
  await h.root.query(`update public.work_orders set status = 'done' where id = $1`, [wo.id]);
  expect(await errcodeOf(() => deactivateUser(w.crewNS))).toBe("SF001");
});

// --- R2 ---------------------------------------------------------------------

test("R2: the last active captain of a vessel with open work cannot be deactivated", async () => {
  await givenWorkOrder(h, { vessel: w.seaVixen, createdBy: w.captainSV, assignee: w.crewSV });
  expect(await errcodeOf(() => deactivateUser(w.captainSV))).toBe("SF002");
});

test("R2: a captain can be deactivated while another captain remains", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  await expect(deactivateUser(w.captainNS)).resolves.toBeDefined();
});

test("R2: the last captain of a quiet vessel can be deactivated", async () => {
  await expect(deactivateUser(w.captainSV)).resolves.toBeDefined();
});

// --- R3 ---------------------------------------------------------------------

test("R3: the last active admin cannot be deactivated", async () => {
  await deactivateUser(w.adminB);
  expect(await errcodeOf(() => deactivateUser(w.adminA))).toBe("SF003");
});

test("R3: the last active admin cannot be demoted out of the role either", async () => {
  await deactivateUser(w.adminB);
  expect(await errcodeOf(() =>
    h.root.query(`update public.users set role = 'crew' where id = $1`, [w.adminA]),
  )).toBe("SF003");
});

// --- R4 ---------------------------------------------------------------------

test("R4: crew cannot be unassigned from a vessel where they hold open work", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  expect(await errcodeOf(() =>
    h.root.query(`delete from public.vessel_assignments where user_id = $1 and vessel_id = $2`,
      [w.crewNS, w.northernStar]),
  )).toBe("SF004");
});

test("R4: open work on another vessel does not block the unassignment", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  await h.root.query(`insert into public.vessel_assignments (user_id, vessel_id) values ($1,$2)`,
    [w.crewNS, w.seaVixen]);
  await expect(
    h.root.query(`delete from public.vessel_assignments where user_id = $1 and vessel_id = $2`,
      [w.crewNS, w.seaVixen]),
  ).resolves.toBeDefined();
});

test("R4: the last captain cannot be unassigned from a vessel with open work", async () => {
  await givenWorkOrder(h, { vessel: w.seaVixen, createdBy: w.captainSV, assignee: w.crewSV });
  expect(await errcodeOf(() =>
    h.root.query(`delete from public.vessel_assignments where user_id = $1 and vessel_id = $2`,
      [w.captainSV, w.seaVixen]),
  )).toBe("SF005");
});

// --- R5 ---------------------------------------------------------------------

test("R5: a vessel with open work cannot be deactivated", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  expect(await errcodeOf(() =>
    h.root.query(`update public.vessels set is_active = false where id = $1`, [w.northernStar]),
  )).toBe("SF006");
});

// --- R6 ---------------------------------------------------------------------

test("R6: crew holding open work cannot be converted to another role", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  expect(await errcodeOf(() =>
    h.root.query(`update public.users set role = 'captain' where id = $1`, [w.crewNS]),
  )).toBe("SF001");
});

test("R6: demoting the only captain of a busy vessel is refused", async () => {
  await givenWorkOrder(h, { vessel: w.seaVixen, createdBy: w.captainSV, assignee: w.crewSV });
  expect(await errcodeOf(() =>
    h.root.query(`update public.users set role = 'crew' where id = $1`, [w.captainSV]),
  )).toBe("SF002");
});

// --- Assignment integrity ---------------------------------------------------

test("admins cannot be assigned to a vessel", async () => {
  expect(await errcodeOf(() =>
    h.root.query(`insert into public.vessel_assignments (user_id, vessel_id) values ($1,$2)`,
      [w.adminA, w.northernStar]),
  )).toBe("SF007");
});

// --- Duplicate prevention ---------------------------------------------------

test("email uniqueness ignores case", async () => {
  expect(await errcodeOf(() =>
    h.root.query(`insert into public.users (full_name, email, role) values ($1,$2,$3)`,
      ["Impostor", "ADA@Seafair.test", "crew"]),
  )).toBe("23505");
});

test("email uniqueness spans deactivated users", async () => {
  await deactivateUser(w.crewNS2);
  expect(await errcodeOf(() =>
    h.root.query(`insert into public.users (full_name, email, role) values ($1,$2,$3)`,
      ["Rin Again", "rin@seafair.test", "crew"]),
  )).toBe("23505");
});

test("vessel name uniqueness ignores case and spans deactivated vessels", async () => {
  expect(await errcodeOf(() =>
    h.root.query(`insert into public.vessels (name) values ('northern star')`),
  )).toBe("23505");
});

test("IMO numbers are unique when present, and absent ones do not collide", async () => {
  expect(await errcodeOf(() =>
    h.root.query(`insert into public.vessels (name, imo_number) values ('Tern', '9074729')`),
  )).toBe("23505");
  await h.root.query(`insert into public.vessels (name) values ('Tern')`);
  await expect(h.root.query(`insert into public.vessels (name) values ('Petrel')`))
    .resolves.toBeDefined();
});

test("an IMO number must be seven digits", async () => {
  expect(await errcodeOf(() =>
    h.root.query(`insert into public.vessels (name, imo_number) values ('Skua', '12345')`),
  )).toBe("23514");
});

// --- Lifecycle CHECK constraints -------------------------------------------

test("a work order cannot reach Done without a solution", async () => {
  const wo = await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  await h.root.query(`update public.work_orders set status = 'in_progress' where id = $1`, [wo.id]);
  expect(await errcodeOf(() =>
    h.root.query(`update public.work_orders set status = 'done' where id = $1`, [wo.id]),
  )).toBe("23514");
});

test("a rejection event cannot be recorded without a comment", async () => {
  const wo = await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  expect(await errcodeOf(() =>
    h.root.query(
      `insert into public.work_order_events (work_order_id, actor_id, type) values ($1,$2,'rejected')`,
      [wo.id, w.captainNS]),
  )).toBe("23514");
});

test("a closed work order is frozen", async () => {
  const wo = await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  await closeWorkOrder(h, wo.id, w.captainNS);
  expect(await errcodeOf(() =>
    h.root.query(`update public.work_orders set title = 'Retitled' where id = $1`, [wo.id]),
  )).toBe("SF020");
});

test("illegal status transitions are refused", async () => {
  const wo = await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  await h.root.query(`update public.work_orders set solution = 'x' where id = $1`, [wo.id]);
  // Open jumps straight to Done, skipping the work.
  expect(await errcodeOf(() =>
    h.root.query(`update public.work_orders set status = 'done' where id = $1`, [wo.id]),
  )).toBe("SF021");
});

test("a work order cannot be moved between vessels", async () => {
  const wo = await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  expect(await errcodeOf(() =>
    h.root.query(`update public.work_orders set vessel_id = $2 where id = $1`, [wo.id, w.seaVixen]),
  )).toBe("SF023");
});
