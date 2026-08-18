import { connectionConfig } from "./db.mts";
import { Client } from "pg";

const cfg = connectionConfig();
console.log(`host     ${cfg.host}`);
console.log(`port     ${cfg.port}`);
console.log(`user     ${cfg.user}`);
console.log(`database ${cfg.database}`);
console.log(`password ${String(cfg.password).length} chars`);

const client = new Client(cfg);
try {
  await client.connect();
  const { rows } = await client.query("select version(), current_user");
  console.log(`\nCONNECTED as ${rows[0].current_user}`);
  console.log(rows[0].version.split(",")[0]);
  await client.end();
} catch (error) {
  const e = error as { message: string; code?: string };
  console.error(`\nFAILED${e.code ? ` [${e.code}]` : ""}: ${e.message}`);
  if (e.code === "28P01") {
    console.error("\n-> Password rejected. Check .env.local matches the password you just set.");
  }
  process.exit(1);
}
