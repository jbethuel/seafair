import { beforeAll, afterAll, beforeEach, expect, test } from "vitest";
import { startHarness, type Harness } from "./harness";
import { seedWorld, errcodeOf, type World } from "./fixtures";

let h: Harness;
let w: World;

beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.stop(); });
beforeEach(async () => { await h.reset(); w = await seedWorld(h); });

const raise = (actor: string, vessel: string, assignee: string, title = "Bilge pump fault") =>
  h.as(actor, async (db) =>
    (await db.query(
      `select * from public.create_work_order($1,$2,$3,$4)`,
      [vessel, title, "Pump cycles but does not prime.", assignee])).rows[0]);

const timeline = async (workOrderId: string) =>
  (await h.root.query(
    `select type, comment from public.work_order_events
      where work_order_id = $1 order by created_at, id`, [workOrderId])).rows;

test("the happy path: raise, start, complete, attest", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  expect(wo.status).toBe("open");
  expect(wo.reference).toMatch(/^WO-\d{6}$/);

  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));
  await h.as(w.crewNS, (db) =>
    db.query(`select public.complete_work_order($1,$2)`, [wo.id, "Replaced the impeller."]));

  const beforeAttest = (await h.root.query(
    `select status, attested_at, is_closed from public.work_orders where id = $1`, [wo.id])).rows[0];
  expect(beforeAttest.status).toBe("done");
  expect(beforeAttest.attested_at).toBeNull();
  expect(beforeAttest.is_closed).toBe(false);

  await h.as(w.captainNS, (db) => db.query(`select public.attest_work_order($1)`, [wo.id]));

  const closed = (await h.root.query(
    `select status, is_closed, attested_by from public.work_orders where id = $1`, [wo.id])).rows[0];
  expect(closed).toMatchObject({ status: "done", is_closed: true, attested_by: w.captainNS });

  expect((await timeline(wo.id)).map((e) => e.type))
    .toEqual(["created", "status_changed", "submitted_for_review", "attested"]);
});

test("rejection returns the work to In Progress and records the reason", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));
  await h.as(w.crewNS, (db) =>
    db.query(`select public.complete_work_order($1,$2)`, [wo.id, "Tightened the clamp."]));

  await h.as(w.captainNS, (db) =>
    db.query(`select public.reject_work_order($1,$2)`, [wo.id, "Clamp is a stopgap; replace the hose."]));

  const after = (await h.root.query(
    `select status, attested_at from public.work_orders where id = $1`, [wo.id])).rows[0];
  expect(after.status).toBe("in_progress");
  expect(after.attested_at).toBeNull();

  const rejection = (await timeline(wo.id)).find((e) => e.type === "rejected");
  expect(rejection?.comment).toBe("Clamp is a stopgap; replace the hose.");
});

test("a rejection without a reason is refused", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));
  await h.as(w.crewNS, (db) => db.query(`select public.complete_work_order($1,$2)`, [wo.id, "Done."]));

  expect(await errcodeOf(() =>
    h.as(w.captainNS, (db) => db.query(`select public.reject_work_order($1,$2)`, [wo.id, "   "])),
  )).toBe("SF026");
});

test("work can be rejected repeatedly and every reason survives", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));

  for (const reason of ["Not sealed.", "Still weeping at the joint."]) {
    await h.as(w.crewNS, (db) => db.query(`select public.complete_work_order($1,$2)`, [wo.id, "Attempted."]));
    await h.as(w.captainNS, (db) => db.query(`select public.reject_work_order($1,$2)`, [wo.id, reason]));
  }

  expect((await timeline(wo.id)).filter((e) => e.type === "rejected").map((e) => e.comment))
    .toEqual(["Not sealed.", "Still weeping at the joint."]);
});

test("completing without a documented solution is refused", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));
  expect(await errcodeOf(() =>
    h.as(w.crewNS, (db) => db.query(`select public.complete_work_order($1,null)`, [wo.id])),
  )).toBe("SF024");
});

// --- Authority --------------------------------------------------------------

test("an admin may not raise a work order", async () => {
  expect(await errcodeOf(() => raise(w.adminA, w.northernStar, w.crewNS))).toBe("SF012");
});

test("an admin may not attest — attestation belongs to captains", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));
  await h.as(w.crewNS, (db) => db.query(`select public.complete_work_order($1,$2)`, [wo.id, "Done."]));
  expect(await errcodeOf(() =>
    h.as(w.adminA, (db) => db.query(`select public.attest_work_order($1)`, [wo.id])),
  )).toBe("SF012");
});

test("a captain may not attest aboard a vessel they are not assigned to", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));
  await h.as(w.crewNS, (db) => db.query(`select public.complete_work_order($1,$2)`, [wo.id, "Done."]));
  expect(await errcodeOf(() =>
    h.as(w.captainSV, (db) => db.query(`select public.attest_work_order($1)`, [wo.id])),
  )).toBe("SF013");
});

test("crew may not attest their own work", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));
  await h.as(w.crewNS, (db) => db.query(`select public.complete_work_order($1,$2)`, [wo.id, "Done."]));
  expect(await errcodeOf(() =>
    h.as(w.crewNS, (db) => db.query(`select public.attest_work_order($1)`, [wo.id])),
  )).toBe("SF012");
});

test("crew may not touch a work order assigned to someone else", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  expect(await errcodeOf(() =>
    h.as(w.crewNS2, (db) => db.query(`select public.start_work_order($1)`, [wo.id])),
  )).toBe("SF019");
});

test("a captain may not raise work aboard another captain's vessel", async () => {
  expect(await errcodeOf(() => raise(w.captainSV, w.northernStar, w.crewNS))).toBe("SF013");
});

test("work may only be assigned to crew, and only crew aboard that vessel", async () => {
  expect(await errcodeOf(() => raise(w.captainNS, w.northernStar, w.captainNS2))).toBe("SF016");
  expect(await errcodeOf(() => raise(w.captainNS, w.northernStar, w.crewSV))).toBe("SF017");
});

test("a deactivated crew member cannot be given work", async () => {
  await h.root.query(`update public.users set is_active = false where id = $1`, [w.crewNS2]);
  expect(await errcodeOf(() => raise(w.captainNS, w.northernStar, w.crewNS2))).toBe("SF015");
});

// --- Reassignment: the escape hatch that keeps deactivation unblockable ------

test("an admin may reassign, which is how a deactivation gets unblocked", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);

  // The guard bites first.
  expect(await errcodeOf(() =>
    h.root.query(`update public.users set is_active = false where id = $1`, [w.crewNS]),
  )).toBe("SF001");

  await h.as(w.adminA, (db) =>
    db.query(`select public.reassign_work_order($1,$2)`, [wo.id, w.crewNS2]));

  // ...and now yields.
  await expect(
    h.root.query(`update public.users set is_active = false where id = $1`, [w.crewNS]),
  ).resolves.toBeDefined();

  expect((await timeline(wo.id)).map((e) => e.type)).toEqual(["created", "reassigned"]);
});

test("crew may not reassign their own work away", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  expect(await errcodeOf(() =>
    h.as(w.crewNS, (db) => db.query(`select public.reassign_work_order($1,$2)`, [wo.id, w.crewNS2])),
  )).toBe("SF027");
});

test("a closed work order cannot be reopened by any route", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));
  await h.as(w.crewNS, (db) => db.query(`select public.complete_work_order($1,$2)`, [wo.id, "Done."]));
  await h.as(w.captainNS, (db) => db.query(`select public.attest_work_order($1)`, [wo.id]));

  expect(await errcodeOf(() =>
    h.as(w.captainNS, (db) => db.query(`select public.reject_work_order($1,$2)`, [wo.id, "Changed my mind."])),
  )).toBe("SF020");
  expect(await errcodeOf(() =>
    h.as(w.adminA, (db) => db.query(`select public.reassign_work_order($1,$2)`, [wo.id, w.crewNS2])),
  )).toBe("SF020");
});

test("crew cannot edit the solution while the captain is reviewing", async () => {
  const wo = await raise(w.captainNS, w.northernStar, w.crewNS);
  await h.as(w.crewNS, (db) => db.query(`select public.start_work_order($1)`, [wo.id]));
  await h.as(w.crewNS, (db) => db.query(`select public.complete_work_order($1,$2)`, [wo.id, "Done."]));
  expect(await errcodeOf(() =>
    h.as(w.crewNS, (db) => db.query(`select public.save_solution($1,$2)`, [wo.id, "Actually..."])),
  )).toBe("SF029");
});

test("references are unique and sequential", async () => {
  const a = await raise(w.captainNS, w.northernStar, w.crewNS, "First");
  const b = await raise(w.captainNS, w.northernStar, w.crewNS, "Second");
  expect(Number(b.reference.slice(3))).toBe(Number(a.reference.slice(3)) + 1);
});
