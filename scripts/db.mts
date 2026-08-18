import { Client, type ClientConfig } from "pg";
import { readFileSync } from "node:fs";

/**
 * Reads .env.local directly rather than through dotenv.
 *
 * dotenv strips `#` as a comment delimiter, and Supabase database passwords
 * routinely contain `#`, `@` and `*`. That truncation is silent: you get a
 * connection string that parses fine and points nowhere. Everything after the
 * first `=` is taken verbatim here, with only surrounding quotes removed.
 */
export function readEnvFile(path = ".env.local"): Record<string, string> {
  const out: Record<string, string> = {};
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export const env = { ...readEnvFile(), ...process.env } as Record<string, string>;

/**
 * Builds the connection.
 *
 * Prefers SUPABASE_DB_PASSWORD, because a bare password cannot be mangled: no
 * percent-encoding, no `@` ambiguity, no `#` comment truncation. The host is
 * derived from the project URL. DATABASE_URL remains supported for anyone who
 * already has one, and is split on its LAST `@` so a password containing `@`
 * is not mistaken for the host separator.
 */
export function connectionConfig(): ClientConfig {
  const ssl = { rejectUnauthorized: false };

  const password = env.SUPABASE_DB_PASSWORD;
  if (password) {
    const projectUrl = env.NEXT_PUBLIC_SUPABASE_URL;
    if (!projectUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required alongside SUPABASE_DB_PASSWORD");
    const ref = new URL(projectUrl).hostname.split(".")[0];
    return {
      host: `db.${ref}.supabase.co`,
      port: 5432,
      user: "postgres",
      password,
      database: "postgres",
      ssl,
    };
  }

  const raw = env.DATABASE_URL;
  if (!raw) {
    throw new Error("Set SUPABASE_DB_PASSWORD (preferred) or DATABASE_URL in .env.local");
  }

  const withoutScheme = raw.replace(/^postgres(?:ql)?:\/\//, "");
  const at = withoutScheme.lastIndexOf("@");
  if (at === -1) throw new Error("DATABASE_URL has no credentials section");

  const credentials = withoutScheme.slice(0, at);
  const hostPart = withoutScheme.slice(at + 1);

  const colon = credentials.indexOf(":");
  const user = credentials.slice(0, colon);
  // Taken literally, never percent-decoded. Supabase shows the password raw and
  // .env.example says to paste it raw, so decoding would corrupt any password
  // containing a literal `%` — and a trailing `%` makes decodeURIComponent throw.
  const urlPassword = credentials.slice(colon + 1);

  const [hostAndPort, database = "postgres"] = hostPart.split("/");
  const lastColon = hostAndPort.lastIndexOf(":");
  const host = lastColon === -1 ? hostAndPort : hostAndPort.slice(0, lastColon);
  const port = lastColon === -1 ? 5432 : Number(hostAndPort.slice(lastColon + 1));

  return { host, port, user, password: urlPassword, database: database.split("?")[0], ssl };
}

export async function connect(): Promise<Client> {
  const client = new Client(connectionConfig());
  await client.connect();
  return client;
}
