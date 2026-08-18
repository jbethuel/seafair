import { SignJWT } from "jose";
import { connect, env } from "./db.mts";

/**
 * Settles C vs C-prime from docs/adr/0001 against the real project.
 *
 * The question is narrow and cannot be answered from documentation: will this
 * project's API gateway accept an HS256 token we signed with its own JWT
 * secret, and will RLS then see a real auth.uid()? Everything downstream —
 * every policy, the whole client data layer — depends on the answer.
 */
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = env.SUPABASE_JWT_SECRET;

const db = await connect();

async function mint(sub: string) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(sub)
    .setAudience("authenticated")
    .setIssuer(`${url}/auth/v1`)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(secret));
}

async function rest(path: string, token?: string) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      Accept: "application/json",
    },
  });
  return { status: res.status, body: await res.text() };
}

try {
  // A minimal world, written as the owner so RLS is not in the way.
  await db.query(`truncate public.work_orders, public.work_order_events,
                           public.vessel_assignments, public.vessels, public.users
                  restart identity cascade`);
  const one = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows[0];

  const vessel = await one(
    `insert into public.vessels (name, imo_number) values ($1,$2) returning id`,
    ["Verification Vessel", "9111111"]);
  const captain = await one(
    `insert into public.users (full_name, email, role) values ($1,$2,'captain') returning id`,
    ["Verify Captain", "verify.captain@seafair.test"]);
  const crew = await one(
    `insert into public.users (full_name, email, role) values ($1,$2,'crew') returning id`,
    ["Verify Crew", "verify.crew@seafair.test"]);
  const outsider = await one(
    `insert into public.users (full_name, email, role) values ($1,$2,'crew') returning id`,
    ["Outsider Crew", "verify.outsider@seafair.test"]);

  for (const userId of [captain.id, crew.id]) {
    await db.query(
      `insert into public.vessel_assignments (user_id, vessel_id) values ($1,$2)`,
      [userId, vessel.id]);
  }

  const wo = await one(
    `insert into public.work_orders (vessel_id, title, issue, created_by, assignee_id)
     values ($1,'Verification job','Proving the token path.',$2,$3) returning reference`,
    [vessel.id, captain.id, crew.id]);

  const ids = {
    captain: captain.id, crew: crew.id,
    outsider: outsider.id, reference: wo.reference,
  };

  console.log(`seeded work order ${ids.reference}\n`);

  const captainToken = await mint(ids.captain);
  const outsiderToken = await mint(ids.outsider);

  const anonRes = await rest("work_orders?select=reference", undefined);
  const captainRes = await rest("work_orders?select=reference", captainToken);
  const outsiderRes = await rest("work_orders?select=reference", outsiderToken);

  console.log(`anon key only     -> ${anonRes.status}  ${anonRes.body.slice(0, 120)}`);
  console.log(`minted (captain)  -> ${captainRes.status}  ${captainRes.body.slice(0, 120)}`);
  console.log(`minted (outsider) -> ${outsiderRes.status}  ${outsiderRes.body.slice(0, 120)}`);

  const gatewayAccepts = captainRes.status === 200;
  const rlsSeesIdentity = gatewayAccepts && captainRes.body.includes(ids.reference);
  const isolationHolds = outsiderRes.status === 200 && !outsiderRes.body.includes(ids.reference);

  console.log("\n---");
  console.log(`gateway accepts our token   ${gatewayAccepts ? "YES" : "NO"}`);
  console.log(`RLS resolves auth.uid()     ${rlsSeesIdentity ? "YES" : "NO"}`);
  console.log(`cross-vessel isolation      ${isolationHolds ? "HOLDS" : "FAILS"}`);
  console.log(
    `\nverdict: ${gatewayAccepts && rlsSeesIdentity && isolationHolds
      ? "PATH C IS VIABLE — proceed as designed"
      : "PATH C FAILED — fall back to C-prime"}`,
  );
} finally {
  await db.end();
}
