import { beforeAll, afterAll, beforeEach, expect, test } from "vitest";
import { startHarness, type Harness } from "./harness";
import { seedWorld, givenWorkOrder, type World } from "./fixtures";

let h: Harness;
let w: World;

beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.stop(); });
beforeEach(async () => { await h.reset(); w = await seedWorld(h); });

const readWorkOrders = (userId: string | null) =>
  h.as(userId, async (db) => (await db.query(`select reference from public.work_orders`)).rows);

test("crew cannot see work orders belonging to another vessel", async () => {
  await givenWorkOrder(h, { vessel: w.seaVixen, createdBy: w.captainSV, assignee: w.crewSV, title: "SV job" });
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS, title: "NS job" });

  const seen = await h.as(w.crewSV, async (db) =>
    (await db.query(`select title from public.work_orders`)).rows.map((r) => r.title));

  expect(seen).toEqual(["SV job"]);
});

test("crew cannot see a shipmate's work order on their own vessel", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS, title: "Tam's" });
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS2, title: "Rin's" });

  const seen = await h.as(w.crewNS, async (db) =>
    (await db.query(`select title from public.work_orders`)).rows.map((r) => r.title));

  expect(seen).toEqual(["Tam's"]);
});

test("a captain sees every work order aboard their vessel, and none elsewhere", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS, title: "Tam's" });
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS2, title: "Rin's" });
  await givenWorkOrder(h, { vessel: w.seaVixen, createdBy: w.captainSV, assignee: w.crewSV, title: "SV job" });

  const seen = await h.as(w.captainNS, async (db) =>
    (await db.query(`select title from public.work_orders order by title`)).rows.map((r) => r.title));

  expect(seen).toEqual(["Rin's", "Tam's"]);
});

test("an admin sees the whole fleet", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  await givenWorkOrder(h, { vessel: w.seaVixen, createdBy: w.captainSV, assignee: w.crewSV });
  expect(await readWorkOrders(w.adminA)).toHaveLength(2);
});

test("a session with no identity sees nothing", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  expect(await readWorkOrders(null)).toEqual([]);
});

test("a deactivated user sees nothing, even holding a valid token", async () => {
  await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS });
  await h.root.query(
    `update public.work_orders set solution='x', status='in_progress' where assignee_id = $1`, [w.crewNS]);
  await h.root.query(`update public.work_orders set status='done' where assignee_id = $1`, [w.crewNS]);
  await h.root.query(
    `update public.work_orders set attested_at=now(), attested_by=$2 where assignee_id = $1`,
    [w.crewNS, w.captainNS]);
  await h.root.query(`update public.users set is_active = false where id = $1`, [w.crewNS]);

  expect(await readWorkOrders(w.crewNS)).toEqual([]);
});

test("vessels are visible only to those assigned, and to admins", async () => {
  const asCrew = await h.as(w.crewSV, async (db) =>
    (await db.query(`select name from public.vessels`)).rows.map((r) => r.name));
  expect(asCrew).toEqual(["Sea Vixen"]);

  const asAdmin = await h.as(w.adminA, async (db) =>
    (await db.query(`select name from public.vessels order by name`)).rows.map((r) => r.name));
  expect(asAdmin).toEqual(["Northern Star", "Sea Vixen"]);
});

test("crew cannot read the roster of a vessel they are not aboard", async () => {
  const seen = await h.as(w.crewSV, async (db) =>
    (await db.query(`select full_name from public.users order by full_name`)).rows.map((r) => r.full_name));
  // Themselves plus their own shipmates only.
  expect(seen).toEqual(["Nils Karlsen", "Pia Moreno"]);
});

test("event history is visible exactly where the work order is", async () => {
  const wo = await givenWorkOrder(h, { vessel: w.northernStar, createdBy: w.captainNS, assignee: w.crewNS2 });
  await h.root.query(
    `insert into public.work_order_events (work_order_id, actor_id, type, to_status)
     values ($1,$2,'created','open')`, [wo.id, w.captainNS]);

  expect(await h.as(w.crewNS, async (db) =>
    (await db.query(`select id from public.work_order_events`)).rows)).toEqual([]);
  expect(await h.as(w.crewNS2, async (db) =>
    (await db.query(`select id from public.work_order_events`)).rows)).toHaveLength(1);
});

test("no member may write the fleet tables directly; only admins may", async () => {
  const captainAttempt = await h.as(w.captainNS, async (db) => {
    try {
      await db.query(`insert into public.vessels (name) values ('Stolen Ship')`);
      return "allowed";
    } catch { return "refused"; }
  });
  expect(captainAttempt).toBe("refused");

  const adminAttempt = await h.as(w.adminA, async (db) => {
    await db.query(`insert into public.vessels (name) values ('Commissioned')`);
    return "allowed";
  });
  expect(adminAttempt).toBe("allowed");
});

test("no member may write work_orders directly, whatever their role", async () => {
  for (const actor of [w.adminA, w.captainNS, w.crewNS]) {
    const outcome = await h.as(actor, async (db) => {
      try {
        await db.query(
          `insert into public.work_orders (vessel_id, title, issue, created_by, assignee_id)
           values ($1,'Direct','Bypassing the functions',$2,$3)`,
          [w.northernStar, w.captainNS, w.crewNS]);
        return "allowed";
      } catch { return "refused"; }
    });
    expect(outcome).toBe("refused");
  }
});
