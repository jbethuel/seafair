import { sweepE2eData } from "./helpers/sweep";

/**
 * Sweeps every artefact an e2e run created.
 *
 * Per-test cleanup is not enough on its own: records created through the
 * interface are not tracked by the fixture that made the fleet, and a failing
 * test never reaches its own teardown. Without this, residue accumulates in the
 * same database a reviewer is looking at.
 */
export default async function globalTeardown() {
  const removed = await sweepE2eData();
  if (removed.users || removed.vessels || removed.workOrders) {
    console.log(
      `\ne2e sweep: removed ${removed.workOrders} work order(s), ` +
        `${removed.users} user(s), ${removed.vessels} vessel(s)`,
    );
  }
}
