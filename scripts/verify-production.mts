import { env } from "./db.mts";

/**
 * Exercises the deployed application exactly as a reviewer's browser would:
 * fetch the roster, mint a session, then read data straight from Supabase with
 * that token. Proves the deployment's environment is wired correctly and that
 * RLS is enforcing on production data, not just locally.
 */
const site = process.argv[2] ?? "https://seafair-eight.vercel.app";
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const roster = await (await fetch(`${site}/api/roster`)).json();
const admin = roster.members.find((m: { role: string }) => m.role === "admin");
const northernStar = roster.vessels.find((v: { name: string }) => v.name === "Northern Star");
const captain = roster.members.find(
  (m: { role: string; vessel_ids: string[] }) =>
    m.role === "captain" && m.vessel_ids.includes(northernStar.id));
const outsider = roster.members.find(
  (m: { role: string; vessel_ids: string[] }) =>
    m.role === "crew" && !m.vessel_ids.includes(northernStar.id));

const session = async (userId: string) => {
  const res = await fetch(`${site}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`session ${res.status}: ${await res.text()}`);
  return (await res.json()).token as string;
};

const read = async (token: string | null, query: string) => {
  const res = await fetch(`${supabaseUrl}/rest/v1/${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token ?? anonKey}` },
  });
  return { status: res.status, body: await res.text() };
};

const nsFilter = `work_orders?select=reference&vessel_id=eq.${northernStar.id}&limit=3`;

const checks: [string, boolean, string][] = [];
const add = (label: string, pass: boolean, detail: string) => checks.push([label, pass, detail]);

const anon = await read(null, nsFilter);
add("public key alone is refused", anon.status === 401, `HTTP ${anon.status}`);

const adminRead = await read(await session(admin.id), "work_orders?select=reference&limit=3");
add("admin sees the fleet", adminRead.status === 200 && adminRead.body.length > 5,
  `HTTP ${adminRead.status}`);

const captainRead = await read(await session(captain.id), nsFilter);
add("captain sees their vessel", captainRead.status === 200 && captainRead.body.includes("WO-"),
  captainRead.body.slice(0, 60));

const outsiderRead = await read(await session(outsider.id), nsFilter);
add("outsider sees nothing of it", outsiderRead.status === 200 && outsiderRead.body.trim() === "[]",
  outsiderRead.body.slice(0, 60));

let deactivated = "n/a";
try {
  await session("00000000-0000-0000-0000-000000000000");
  deactivated = "minted a token for a non-existent member";
} catch (e) {
  deactivated = (e as Error).message.slice(0, 40);
}
add("unknown member gets no token", deactivated.startsWith("session 404"), deactivated);

console.log(`\nProduction check — ${site}\n`);
for (const [label, pass, detail] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${detail}`);
}
const failed = checks.filter(([, p]) => !p).length;
console.log(`\n${failed === 0 ? "All checks passed." : `${failed} check(s) FAILED.`}`);
process.exit(failed === 0 ? 0 : 1);
