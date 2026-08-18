import { connectionConfig } from "./db.mts";
import { Client } from "pg";

const base = connectionConfig();
const literal = String(base.password);

let decoded: string | null = null;
try { decoded = decodeURIComponent(literal); } catch { decoded = null; }

const attempts: Array<[string, string | null]> = [
  ["as written (literal)", literal],
  ["percent-decoded", decoded !== null && decoded !== literal ? decoded : null],
];

for (const [label, password] of attempts) {
  if (password === null) {
    console.log(`${label.padEnd(22)} -> not applicable`);
    continue;
  }
  const client = new Client({ ...base, password, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    await client.query("select 1");
    console.log(`${label.padEnd(22)} -> SUCCESS (${password.length} chars)`);
    await client.end();
    process.exit(0);
  } catch (error) {
    const e = error as { message: string; code?: string };
    console.log(`${label.padEnd(22)} -> ${e.code ?? "ERR"}: ${e.message.slice(0, 60)}`);
    await client.end().catch(() => {});
  }
}
console.log("\nNeither interpretation authenticated.");
process.exit(1);
