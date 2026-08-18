import { SignJWT } from "jose";
import { connect, env } from "./db.mts";

/**
 * Checks the two things the scalability criterion actually tests: does the
 * list query use its index under RLS, and does a real request return quickly.
 *
 * The specific hazard being checked is RLS re-evaluating its helper functions
 * once per row. Policies wrap every call in (select ...) to prevent it; this
 * is what confirms the prevention works against real volume.
 */
const db = await connect();

try {
  const captain = (await db.query(`
    select u.id, u.full_name, va.vessel_id, v.name as vessel
    from public.users u
    join public.vessel_assignments va on va.user_id = u.id
    join public.vessels v on v.id = va.vessel_id
    where u.role = 'captain' and u.is_active
      and v.name <> 'Northern Star'
    limit 1`)).rows[0];

  const total = (await db.query(
    `select count(*) from public.work_orders where vessel_id = $1`, [captain.vessel_id])).rows[0].count;
  console.log(`${captain.full_name}, captain of ${captain.vessel} — ${total} work orders aboard\n`);

  // Run the list query exactly as the browser will: as `authenticated`, with
  // the captain's claims, so every RLS policy is in the path.
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: captain.id, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");

  const listQuery = `
    select id, reference, title, status, assignee_id, created_at
    from public.work_orders
    where vessel_id = $1
    order by created_at desc, id desc
    limit 25`;

  const plan = (await db.query(
    `explain (analyze, buffers, format text) ${listQuery}`, [captain.vessel_id])).rows;
  console.log("--- plan ---");
  for (const row of plan) console.log(" ", row["QUERY PLAN"]);

  const runs: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await db.query(listQuery, [captain.vessel_id]);
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  console.log(`\nfirst page  median ${runs[10].toFixed(1)}ms  p95 ${runs[18].toFixed(1)}ms`);

  // Second page via cursor, which is the pattern the UI uses.
  const firstPage = (await db.query(listQuery, [captain.vessel_id])).rows;
  const cursor = firstPage.at(-1)!;
  const cursorRuns: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await db.query(`
      select id, reference, title, status, created_at
      from public.work_orders
      where vessel_id = $1 and (created_at, id) < ($2, $3)
      order by created_at desc, id desc
      limit 25`, [captain.vessel_id, cursor.created_at, cursor.id]);
    cursorRuns.push(performance.now() - t);
  }
  cursorRuns.sort((a, b) => a - b);
  console.log(`next page   median ${cursorRuns[10].toFixed(1)}ms  p95 ${cursorRuns[18].toFixed(1)}ms`);

  await db.query("reset role");

  // And over the wire, as the browser genuinely does it.
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(captain.id).setAudience("authenticated")
    .setIssuer(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`)
    .setIssuedAt(now).setExpirationTime(now + 600)
    .sign(new TextEncoder().encode(env.SUPABASE_JWT_SECRET));

  const httpRuns: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t = performance.now();
    const res = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/work_orders` +
      `?select=reference,title,status&order=created_at.desc,id.desc&limit=25`,
      { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    await res.text();
    httpRuns.push(performance.now() - t);
  }
  httpRuns.sort((a, b) => a - b);
  console.log(`over HTTPS  median ${httpRuns[5].toFixed(0)}ms (includes network round trip)`);
} finally {
  await db.end();
}
