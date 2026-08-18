import { writeFile } from "node:fs/promises";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Concatenates the migrations into a single schema.sql for the submission.
 *
 * Generated from the migrations rather than hand-maintained, so the two cannot
 * drift. Re-run with `pnpm db:schema` after adding a migration.
 */
const MIGRATIONS_DIR = resolve(import.meta.dirname, "../supabase/migrations");
const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

const parts = [
  `-- Seafair — complete database schema.
--
-- GENERATED FILE. Built from supabase/migrations by \`pnpm db:schema\`.
-- Edit the migrations, not this file.
--
-- Applying this to an empty Postgres reproduces the database exactly, provided
-- the anon, authenticated and service_role roles exist (Supabase creates them).
`,
];

for (const file of files) {
  parts.push(`\n-- ${"=".repeat(74)}\n-- ${file}\n-- ${"=".repeat(74)}\n`);
  parts.push(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
}

await writeFile(resolve(import.meta.dirname, "../schema.sql"), parts.join("\n"));
console.log(`schema.sql written from ${files.length} migrations`);
