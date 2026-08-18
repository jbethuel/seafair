import { connect } from "../../scripts/db.mts";
import type { Client } from "pg";

/**
 * Creates an isolated fleet for one test.
 *
 * Deliberately does NOT reseed: the showcase data on Northern Star is what a
 * reviewer opens the live link to see, and a test run should not destroy it.
 * Every fixture is uniquely named so parallel or repeated runs cannot collide.
 */
export interface TestFleet {
  vessel: { id: string; name: string };
  captain: { id: string; name: string };
  secondCaptain: { id: string; name: string };
  crew: { id: string; name: string };
  otherCrew: { id: string; name: string };
  admin: { id: string; name: string };
  /** Raise a work order directly, for tests that start mid-lifecycle. */
  givenWorkOrder(opts?: { title?: string; assignee?: string }): Promise<{ id: string; reference: string }>;
  cleanup(): Promise<void>;
}

/** Every e2e artefact is named so the sweep can find it, and only it. */
export const E2E_PREFIX = "E2E ";
export const E2E_EMAIL_DOMAIN = "@e2e.test";

const tag = () => Math.random().toString(36).slice(2, 7).toUpperCase();

export async function createTestFleet(label: string): Promise<TestFleet> {
  const db: Client = await connect();
  const suffix = tag();
  const created: { users: string[]; vessels: string[] } = { users: [], vessels: [] };

  const addUser = async (name: string, role: string) => {
    const full = `${name} ${suffix}`;
    const { rows } = await db.query(
      `insert into public.users (full_name, email, role)
       values ($1, $2, $3) returning id`,
      [full, `${role}.${suffix.toLowerCase()}.${Date.now()}${E2E_EMAIL_DOMAIN}`, role],
    );
    created.users.push(rows[0].id);
    return { id: rows[0].id as string, name: full };
  };

  const vesselName = `${E2E_PREFIX}${label} ${suffix}`;
  const { rows: vrows } = await db.query(
    `insert into public.vessels (name) values ($1) returning id`, [vesselName]);
  created.vessels.push(vrows[0].id);
  const vessel = { id: vrows[0].id as string, name: vesselName };

  const captain = await addUser("Cap", "captain");
  const secondCaptain = await addUser("Mate", "captain");
  const crew = await addUser("Hand", "crew");
  const otherCrew = await addUser("Deck", "crew");
  const admin = await addUser("Super", "admin");

  for (const u of [captain, secondCaptain, crew, otherCrew]) {
    await db.query(
      `insert into public.vessel_assignments (user_id, vessel_id) values ($1,$2)`,
      [u.id, vessel.id]);
  }

  return {
    vessel, captain, secondCaptain, crew, otherCrew, admin,

    async givenWorkOrder(opts = {}) {
      const { rows } = await db.query(
        `insert into public.work_orders (vessel_id, title, issue, created_by, assignee_id)
         values ($1,$2,$3,$4,$5) returning id, reference`,
        [vessel.id, opts.title ?? "Seized bilge valve",
         "Valve will not turn by hand and the packing is weeping.",
         captain.id, opts.assignee ?? crew.id],
      );
      return rows[0] as { id: string; reference: string };
    },

    async cleanup() {
      try {
        // Note: an attested work order cannot be un-attested, not even here —
        // the transition guard refuses any update to a closed record. Deletion
        // is unaffected, since that guard is BEFORE UPDATE only.
        await db.query(`delete from public.work_orders where vessel_id = $1`, [vessel.id]);
        await db.query(`delete from public.vessel_assignments where vessel_id = $1`, [vessel.id]);
        await db.query(`delete from public.users where id = any($1)`, [created.users]);
        await db.query(`delete from public.vessels where id = any($1)`, [created.vessels]);
      } finally {
        await db.end();
      }
    },
  };
}

/** Direct database read, for asserting on what the UI actually persisted. */
export async function readWorkOrder(id: string) {
  const db = await connect();
  try {
    const { rows } = await db.query(
      `select status, solution, attested_at, attested_by, assignee_id, is_closed
         from public.work_orders where id = $1`, [id]);
    return rows[0];
  } finally {
    await db.end();
  }
}

export async function readEvents(workOrderId: string) {
  const db = await connect();
  try {
    const { rows } = await db.query(
      `select type, comment, from_status, to_status
         from public.work_order_events
        where work_order_id = $1 order by created_at, id`, [workOrderId]);
    return rows as { type: string; comment: string | null;
                     from_status: string | null; to_status: string | null }[];
  } finally {
    await db.end();
  }
}

export async function emailOf(userId: string): Promise<string> {
  const db = await connect();
  try {
    const { rows } = await db.query(`select email from public.users where id = $1`, [userId]);
    return rows[0].email as string;
  } finally {
    await db.end();
  }
}

/** Removes a vessel created by a test through the interface. */
export async function deleteVesselNamed(name: string): Promise<void> {
  const db = await connect();
  try {
    await db.query(`delete from public.vessels where lower(name) = lower($1)`, [name]);
  } finally {
    await db.end();
  }
}
