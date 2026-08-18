import { connect } from "../../scripts/db.mts";
import { E2E_EMAIL_DOMAIN, E2E_PREFIX } from "./fleet";

/**
 * Removes everything an e2e run created, identified by naming convention:
 * vessels prefixed "E2E " and users on the @e2e.test domain. Nothing else is
 * touched, so the seeded showcase fleet survives.
 *
 * Order matters. Work orders reference users with ON DELETE RESTRICT, and the
 * assignment-removal guard refuses to unassign crew who still hold open work —
 * so the work orders have to go first, or the database quite correctly blocks
 * its own cleanup.
 */
export async function sweepE2eData() {
  const db = await connect();
  try {
    const vesselFilter = `name like $1`;
    const like = `${E2E_PREFIX}%`;
    const emailLike = `%${E2E_EMAIL_DOMAIN}`;

    const workOrders = await db.query(
      `delete from public.work_orders
        where vessel_id in (select id from public.vessels where ${vesselFilter})
           or created_by  in (select id from public.users where email like $2)
           or assignee_id in (select id from public.users where email like $2)`,
      [like, emailLike],
    );

    await db.query(
      `delete from public.vessel_assignments
        where vessel_id in (select id from public.vessels where ${vesselFilter})
           or user_id in (select id from public.users where email like $2)`,
      [like, emailLike],
    );

    const users = await db.query(
      `delete from public.users where email like $1`, [emailLike]);
    const vessels = await db.query(
      `delete from public.vessels where ${vesselFilter}`, [like]);

    return {
      workOrders: workOrders.rowCount ?? 0,
      users: users.rowCount ?? 0,
      vessels: vessels.rowCount ?? 0,
    };
  } finally {
    await db.end();
  }
}
