import type { Harness } from "./harness";

/**
 * A small, fully-specified world. Two vessels so cross-vessel isolation is
 * testable, two captains on Northern Star so "last captain" rules have
 * something to distinguish, and two admins so R3 can be exercised both ways.
 */
export interface World {
  adminA: string; adminB: string;
  northernStar: string; seaVixen: string;
  captainNS: string; captainNS2: string; captainSV: string;
  crewNS: string; crewNS2: string; crewSV: string;
}

export async function seedWorld(h: Harness): Promise<World> {
  const user = async (name: string, email: string, role: string) => {
    const { rows } = await h.root.query(
      `insert into public.users (full_name, email, role) values ($1,$2,$3) returning id`,
      [name, email, role],
    );
    return rows[0].id as string;
  };
  const vessel = async (name: string, imo: string | null) => {
    const { rows } = await h.root.query(
      `insert into public.vessels (name, imo_number) values ($1,$2) returning id`,
      [name, imo],
    );
    return rows[0].id as string;
  };
  const assign = (userId: string, vesselId: string) =>
    h.root.query(
      `insert into public.vessel_assignments (user_id, vessel_id) values ($1,$2)`,
      [userId, vesselId],
    );

  const w: World = {
    adminA: await user("Ada Harbour", "ada@seafair.test", "admin"),
    adminB: await user("Bo Quayle", "bo@seafair.test", "admin"),
    northernStar: await vessel("Northern Star", "9074729"),
    seaVixen: await vessel("Sea Vixen", "9182395"),
    captainNS: "", captainNS2: "", captainSV: "",
    crewNS: "", crewNS2: "", crewSV: "",
  };

  w.captainNS = await user("Iris Fen", "iris@seafair.test", "captain");
  w.captainNS2 = await user("Юрий Полев", "yuri@seafair.test", "captain");
  w.captainSV = await user("Nils Karlsen", "nils@seafair.test", "captain");
  w.crewNS = await user("Tam Oduya", "tam@seafair.test", "crew");
  w.crewNS2 = await user("Rin Sato", "rin@seafair.test", "crew");
  w.crewSV = await user("Pia Moreno", "pia@seafair.test", "crew");

  await assign(w.captainNS, w.northernStar);
  await assign(w.captainNS2, w.northernStar);
  await assign(w.crewNS, w.northernStar);
  await assign(w.crewNS2, w.northernStar);
  await assign(w.captainSV, w.seaVixen);
  await assign(w.crewSV, w.seaVixen);

  return w;
}

/** Raise a work order directly, bypassing the lifecycle functions, for setup. */
export async function givenWorkOrder(
  h: Harness,
  opts: { vessel: string; createdBy: string; assignee: string; title?: string },
) {
  const { rows } = await h.root.query(
    `insert into public.work_orders (vessel_id, title, issue, created_by, assignee_id)
     values ($1,$2,$3,$4,$5) returning *`,
    [opts.vessel, opts.title ?? "Bilge pump fault", "Pump cycles but does not prime.",
     opts.createdBy, opts.assignee],
  );
  return rows[0];
}

/** Drive a work order all the way to Closed, so guards see no Open Work. */
export async function closeWorkOrder(h: Harness, workOrderId: string, captainId: string) {
  await h.root.query(
    `update public.work_orders
        set solution = 'Replaced impeller and primed the line.',
            status = 'in_progress'
      where id = $1`, [workOrderId]);
  await h.root.query(`update public.work_orders set status = 'done' where id = $1`, [workOrderId]);
  await h.root.query(
    `update public.work_orders set attested_at = now(), attested_by = $2 where id = $1`,
    [workOrderId, captainId]);
}

/** The SQLSTATE Postgres raised, e.g. 'SF001'. */
export async function errcodeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return (error as { code?: string }).code ?? "NO_CODE";
  }
  throw new Error("Expected the database to refuse this, but it succeeded.");
}
