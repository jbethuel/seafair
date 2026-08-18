import { connect } from "./db.mts";

/**
 * Seeds in two deliberate layers.
 *
 * Vessel one gets hand-authored showcase fixtures guaranteeing at least one
 * work order in every state, including one rejected twice with a visible
 * timeline. A reviewer landing on the default view sees the whole lifecycle
 * within seconds rather than hunting for it.
 *
 * The remaining vessels carry bulk volume so pagination and the indexes are
 * doing real work rather than being asserted in a README.
 */
const BULK_WORK_ORDERS = 5_000;

const VESSELS = [
  { name: "Northern Star", imo: "9074729" },
  { name: "Sea Vixen", imo: "9182395" },
  { name: "Aurora Borealis", imo: "9265791" },
  { name: "Kittiwake", imo: "9311842" },
  { name: "Meridian Dawn", imo: "9403617" },
  { name: "Orkney Trader", imo: "9518204" },
  { name: "Pelagic Rose", imo: "9627351" },
  { name: "Thorfinn", imo: null },
];

const FIRST = ["Iris","Tam","Rin","Nils","Pia","Yuki","Omar","Freya","Callum","Sofia",
  "Mateo","Aoife","Kwame","Lena","Dmitri","Nadia","Elias","Marta","Bo","Ada",
  "Hana","Ivo","Jonas","Kira","Lars","Mei","Noor","Otto","Priya","Quinn"];
const LAST = ["Fen","Oduya","Sato","Karlsen","Moreno","Tanaka","Haddad","Lindqvist",
  "Bright","Rossi","Alvarez","Byrne","Mensah","Vogt","Petrov","Amari","Nyman","Silva",
  "Quayle","Harbour","Okonkwo","Bergman","Lund","Farrell","Novak","Chen","Rahman",
  "Keller","Iyer","Walsh"];

const FAULTS = [
  ["Bilge pump cycling", "Pump runs but will not prime; suction line may be airlocked."],
  ["Port navigation light out", "Bulb replaced, still dark. Suspect corroded terminal."],
  ["Galley refrigeration warm", "Holding at 9C against a 4C setpoint since Tuesday."],
  ["Winch brake slipping", "Brake band does not hold under load on the aft winch."],
  ["VHF squelch noisy", "Persistent static on channel 16 across all power settings."],
  ["Fuel polisher alarm", "Differential pressure alarm trips within an hour of running."],
  ["Steering gear judder", "Noticeable judder in the rudder at low speed."],
  ["Fire door latch failed", "Latch on the engine room door does not hold closed."],
  ["Life raft cradle rusted", "Cradle mounting shows heavy corrosion at the welds."],
  ["Anchor windlass slow", "Windlass hauls slowly; suspect worn brushes in the motor."],
  ["Freshwater pump surging", "Pressure oscillates and the pump short-cycles."],
  ["Radar heading marker offset", "Heading marker sits about eight degrees off centreline."],
];

const REMEDIES = [
  "Stripped and reseated the assembly, then confirmed correct operation over a full cycle.",
  "Replaced the failed component from ship's stores and logged the part number.",
  "Cleaned and dressed corroded contacts, then applied dielectric grease.",
  "Bled the line and topped up the reservoir; no recurrence over two watches.",
  "Adjusted to specification and verified against the maintenance manual.",
];

const rand = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
// Whole-day offsets cluster a dozen rows onto "just now" at the top of the list.
// A fractional jitter spreads them across the day so the column reads naturally.
const daysAgoJittered = (n: number) =>
  new Date(Date.now() - (n + Math.random()) * 86_400_000).toISOString();

const db = await connect();

try {
  console.log("clearing existing data...");
  await db.query(`truncate public.work_order_events, public.work_orders,
                           public.vessel_assignments, public.vessels, public.users
                  restart identity cascade`);
  await db.query(`alter sequence app.work_order_reference_seq restart with 1`);

  // --- People ---------------------------------------------------------------
  const usedEmails = new Set<string>();
  const emailFor = (name: string) => {
    const base = name.toLowerCase().replace(/[^a-z]+/g, ".");
    let email = `${base}@seafair.test`;
    let n = 2;
    while (usedEmails.has(email)) email = `${base}${n++}@seafair.test`;
    usedEmails.add(email);
    return email;
  };

  const insertUser = async (name: string, role: string) =>
    (await db.query(
      `insert into public.users (full_name, email, role) values ($1,$2,$3) returning id`,
      [name, emailFor(name), role])).rows[0].id as string;

  const admins = [
    await insertUser("Ada Harbour", "admin"),
    await insertUser("Bo Quayle", "admin"),
  ];

  const vessels: { id: string; name: string; captains: string[]; crew: string[] }[] = [];
  for (const v of VESSELS) {
    const id = (await db.query(
      `insert into public.vessels (name, imo_number) values ($1,$2) returning id`,
      [v.name, v.imo])).rows[0].id as string;
    vessels.push({ id, name: v.name, captains: [], crew: [] });
  }

  // Two captains and six crew per vessel: enough that "last active captain"
  // rules have something to distinguish, and enough crew for reassignment.
  //
  // Names are drawn from a shuffled pool of distinct first/last pairings. Naive
  // index arithmetic produces rosters full of near-duplicates — a dozen people
  // surnamed Fen, and crew sharing first names with the admins — which reads as
  // carelessness on the one screen a reviewer studies closely.
  const namePool: string[] = [];
  const adminFirstNames = new Set(["Ada", "Bo"]);
  for (const last of LAST) {
    for (const first of FIRST) {
      if (adminFirstNames.has(first)) continue;
      namePool.push(`${first} ${last}`);
    }
  }
  for (let i = namePool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [namePool[i], namePool[j]] = [namePool[j], namePool[i]];
  }

  const usedNames = new Set<string>();
  let nameIndex = 0;
  const nextName = () => {
    while (nameIndex < namePool.length) {
      const candidate = namePool[nameIndex++];
      const [, surname] = candidate.split(" ");
      // Cap how often any surname recurs, so the roster reads like a crew list
      // rather than one extended family.
      const surnameCount = [...usedNames].filter((n) => n.endsWith(` ${surname}`)).length;
      if (surnameCount >= 3) continue;
      usedNames.add(candidate);
      return candidate;
    }
    throw new Error("Name pool exhausted");
  };

  // The showcase vessel's crew are named, not drawn from the pool. The README's
  // walkthrough tells a reviewer exactly who to select, and a reshuffle on every
  // reseed would send them hunting for people who no longer exist.
  const SHOWCASE_CAPTAINS = ["Iris Fenwick", "Lena Sato"];
  const SHOWCASE_CREW = [
    "Tam Oduya", "Rin Kato", "Noor Haddad",
    "Callum Byrne", "Freya Lindqvist", "Kwame Mensah",
  ];

  for (const [index, vessel] of vessels.entries()) {
    const isShowcase = index === 0;

    for (let i = 0; i < 2; i++) {
      const name = isShowcase ? SHOWCASE_CAPTAINS[i] : nextName();
      if (isShowcase) usedNames.add(name);
      const id = await insertUser(name, "captain");
      await db.query(`insert into public.vessel_assignments (user_id, vessel_id) values ($1,$2)`,
        [id, vessel.id]);
      vessel.captains.push(id);
    }
    for (let i = 0; i < 6; i++) {
      const name = isShowcase ? SHOWCASE_CREW[i] : nextName();
      if (isShowcase) usedNames.add(name);
      const id = await insertUser(name, "crew");
      await db.query(`insert into public.vessel_assignments (user_id, vessel_id) values ($1,$2)`,
        [id, vessel.id]);
      vessel.crew.push(id);
    }
  }

  console.log(`seeded ${admins.length} admins, ${vessels.length} vessels, ${usedNames.size} officers and crew`);

  // --- Showcase fixtures on the first vessel --------------------------------
  const show = vessels[0];
  const [captain, secondCaptain] = show.captains;

  const raise = async (title: string, issue: string, assignee: string, ageDays: number) =>
    (await db.query(
      `insert into public.work_orders (vessel_id, title, issue, created_by, assignee_id, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$6) returning id, reference`,
      [show.id, title, issue, captain, assignee, daysAgo(ageDays)])).rows[0];

  const event = (workOrderId: string, actor: string, type: string,
                 from: string | null, to: string | null, comment: string | null, ageDays: number) =>
    db.query(
      `insert into public.work_order_events
         (work_order_id, actor_id, type, from_status, to_status, comment, created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [workOrderId, actor, type, from, to, comment, daysAgo(ageDays)]);

  // 1. Freshly raised, untouched.
  const a = await raise(FAULTS[0][0], FAULTS[0][1], show.crew[0], 2);
  await event(a.id, captain, "created", null, "open", null, 2);

  // 2. Under way.
  const b = await raise(FAULTS[1][0], FAULTS[1][1], show.crew[1], 5);
  await event(b.id, captain, "created", null, "open", null, 5);
  await db.query(`update public.work_orders set status='in_progress' where id=$1`, [b.id]);
  await event(b.id, show.crew[1], "status_changed", "open", "in_progress", null, 4);

  // 3. Done, awaiting the captain — the state a reviewer most needs to find.
  const c = await raise(FAULTS[2][0], FAULTS[2][1], show.crew[2], 9);
  await event(c.id, captain, "created", null, "open", null, 9);
  await db.query(`update public.work_orders set status='in_progress' where id=$1`, [c.id]);
  await event(c.id, show.crew[2], "status_changed", "open", "in_progress", null, 8);
  await db.query(`update public.work_orders set solution=$2, status='done' where id=$1`,
    [c.id, "Recharged the system and replaced the door seal; holding at 4C overnight."]);
  await event(c.id, show.crew[2], "submitted_for_review", "in_progress", "done", null, 6);

  // 4. Rejected twice, now back with the crew, carrying a full timeline.
  const d = await raise(FAULTS[3][0], FAULTS[3][1], show.crew[3], 20);
  await event(d.id, captain, "created", null, "open", null, 20);
  await db.query(`update public.work_orders set status='in_progress' where id=$1`, [d.id]);
  await event(d.id, show.crew[3], "status_changed", "open", "in_progress", null, 19);
  for (const [attempt, reason, age] of [
    ["Adjusted the brake band tension.", "Still slips above half load. Measure the lining thickness.", 16],
    ["Backed off the adjuster and re-torqued.", "Lining is below service limit; it needs replacing, not adjusting.", 11],
  ] as const) {
    await db.query(`update public.work_orders set solution=$2, status='done' where id=$1`, [d.id, attempt]);
    await event(d.id, show.crew[3], "submitted_for_review", "in_progress", "done", null, age + 1);
    await db.query(`update public.work_orders set status='in_progress' where id=$1`, [d.id]);
    await event(d.id, secondCaptain, "rejected", "done", "in_progress", reason, age);
  }

  // 5. Closed: done and attested.
  const e = await raise(FAULTS[4][0], FAULTS[4][1], show.crew[4], 30);
  await event(e.id, captain, "created", null, "open", null, 30);
  await db.query(`update public.work_orders set status='in_progress' where id=$1`, [e.id]);
  await event(e.id, show.crew[4], "status_changed", "open", "in_progress", null, 29);
  await db.query(`update public.work_orders set solution=$2, status='done' where id=$1`,
    [e.id, "Replaced the antenna feedline and re-tuned; channel 16 now clear."]);
  await event(e.id, show.crew[4], "submitted_for_review", "in_progress", "done", null, 27);
  await db.query(`update public.work_orders set attested_at=$2, attested_by=$3 where id=$1`,
    [e.id, daysAgo(26), captain]);
  await event(e.id, captain, "attested", "done", "done", null, 26);

  console.log(`seeded 5 showcase work orders on ${show.name} (${a.reference}-${e.reference})`);

  // --- Bulk volume ----------------------------------------------------------
  console.log(`seeding ${BULK_WORK_ORDERS} work orders across the rest of the fleet...`);
  const others = vessels.slice(1);
  const batchSize = 500;

  for (let start = 0; start < BULK_WORK_ORDERS; start += batchSize) {
    const rows: unknown[] = [];
    const tuples: string[] = [];
    let p = 1;

    for (let i = start; i < Math.min(start + batchSize, BULK_WORK_ORDERS); i++) {
      const vessel = others[i % others.length];
      const [title, issue] = rand(FAULTS);
      const assignee = rand(vessel.crew);
      const author = rand(vessel.captains);
      // Weight toward recent work so the default view is lively, with a long
      // tail of history behind it.
      const age = Math.floor(Math.random() ** 1.8 * 400) + 0.05;

      // Weighted so the fleet looks like real operations: mostly closed work,
      // a healthy tail in progress, a few awaiting attestation.
      const roll = Math.random();
      const status = roll < 0.18 ? "open" : roll < 0.42 ? "in_progress" : "done";
      const attested = status === "done" && Math.random() < 0.82;
      const solution = status === "done" ? rand(REMEDIES) : roll < 0.32 ? rand(REMEDIES) : null;

      tuples.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      rows.push(vessel.id, title, issue, solution, status, author, assignee,
        attested ? daysAgoJittered(Math.max(age - 1, 0)) : null,
        attested ? author : null, daysAgoJittered(age));
    }

    await db.query(
      `insert into public.work_orders
         (vessel_id, title, issue, solution, status, created_by, assignee_id,
          attested_at, attested_by, created_at)
       values ${tuples.join(",")}`,
      rows);

    process.stdout.write(`\r  ${Math.min(start + batchSize, BULK_WORK_ORDERS)} / ${BULK_WORK_ORDERS}`);
  }
  console.log();

  // A creation event for every bulk work order, so timelines are never empty.
  await db.query(`
    insert into public.work_order_events (work_order_id, actor_id, type, to_status, created_at)
    select wo.id, wo.created_by, 'created', 'open', wo.created_at
    from public.work_orders wo
    where not exists (
      select 1 from public.work_order_events e where e.work_order_id = wo.id
    )
  `);

  const summary = await db.query(`
    select
      (select count(*) from public.users) as users,
      (select count(*) from public.vessels) as vessels,
      (select count(*) from public.work_orders) as work_orders,
      (select count(*) from public.work_orders where not is_closed) as open_work,
      (select count(*) from public.work_orders where status='done' and attested_at is null) as awaiting,
      (select count(*) from public.work_order_events) as events
  `);
  console.log("\n", summary.rows[0]);
} finally {
  await db.end();
}
