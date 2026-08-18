import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { connect } from "./db.mts";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../supabase/migrations");
const reset = process.argv.includes("--reset");

const db = await connect();

try {
  if (reset) {
    // The migrations are not individually idempotent by design: they read as a
    // schema definition rather than a pile of IF NOT EXISTS. During development
    // a clean rebuild is therefore the honest reset.
    console.log("resetting schemas...");
    await db.query(`
      drop schema if exists app cascade;
      drop schema if exists public cascade;
      create schema public;
      grant usage on schema public to anon, authenticated, service_role;
      grant all on schema public to postgres;
    `);
  }

  await db.query(`
    create table if not exists public.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Set(
    (await db.query<{ version: string }>("select version from public.schema_migrations")).rows
      .map((r) => r.version),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    process.stdout.write(`  apply ${file} ... `);
    try {
      await db.query("begin");
      await db.query(sql);
      await db.query("insert into public.schema_migrations (version) values ($1)", [file]);
      await db.query("commit");
      console.log("ok");
      ran++;
    } catch (error) {
      await db.query("rollback");
      console.log("FAILED");
      console.error(`\n${(error as Error).message}\n`);
      process.exit(1);
    }
  }

  console.log(ran === 0 ? "\nnothing to apply; database is up to date" : `\napplied ${ran} migration(s)`);
} finally {
  await db.end();
}
