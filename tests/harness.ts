import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../supabase/migrations");

/**
 * A disposable Postgres with the migrations applied and Supabase's two roles
 * created, so policies and grants behave exactly as they will in production.
 *
 * Nothing here touches Supabase itself: the migrations depend only on
 * current_setting() and the anon/authenticated roles, which is what makes this
 * possible — and is itself worth preserving.
 */
export interface Harness {
  /** Runs as the migration owner, bypassing RLS. Use for setup and assertions. */
  root: Client;
  /** Runs as `authenticated` with the given user's claims, exactly as PostgREST would. */
  as<T>(userId: string | null, fn: (db: Client) => Promise<T>): Promise<T>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), "seafair-pg-"));
  const port = 5000 + Math.floor(Math.random() * 2000);

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("seafair");

  const connect = async () => {
    const c = new Client({
      host: "localhost",
      port,
      user: "postgres",
      password: "postgres",
      database: "seafair",
    });
    await c.connect();
    return c;
  };

  const root = await connect();

  // Supabase provides these; a bare Postgres does not.
  await root.query(`
    create role anon nologin;
    create role authenticated nologin;
    grant anon, authenticated to postgres;
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await root.query(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  const snapshot = await captureSnapshot(root);

  return {
    root,

    async as(userId, fn) {
      const db = await connect();
      try {
        // PostgREST sets request.jwt.claims from the verified token; this is the
        // same channel, so app.current_user_id() cannot tell the difference.
        await db.query("select set_config('request.jwt.claims', $1, false)", [
          JSON.stringify(userId ? { sub: userId, role: "authenticated" } : {}),
        ]);
        await db.query("set role authenticated");
        // Writes commit: a lifecycle spans several actors, so one session's work
        // has to be visible to the next. Isolation comes from reset().
        return await fn(db);
      } finally {
        await db.end();
      }
    },

    async reset() {
      await root.query(snapshot);
    },

    async stop() {
      await root.end();
      await pg.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Truncation script covering every table, for per-test isolation. */
async function captureSnapshot(root: Client): Promise<string> {
  const { rows } = await root.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = rows.map((r) => `public.${r.tablename}`).join(", ");
  return `truncate ${tables} restart identity cascade;`;
}
