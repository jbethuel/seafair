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
 * Splits the connection URI on its LAST `@`, so an unencoded `@` inside the
 * password cannot be mistaken for the host separator, and hands pg discrete
 * fields so no URI escaping is involved at all.
 */
export function connectionConfig(): ClientConfig {
  const raw = env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set in .env.local");

  const withoutScheme = raw.replace(/^postgres(?:ql)?:\/\//, "");
  const at = withoutScheme.lastIndexOf("@");
  if (at === -1) throw new Error("DATABASE_URL has no credentials section");

  const credentials = withoutScheme.slice(0, at);
  const hostPart = withoutScheme.slice(at + 1);

  const colon = credentials.indexOf(":");
  const user = decodeURIComponent(credentials.slice(0, colon));
  const rawPassword = credentials.slice(colon + 1);
  const password = /%[0-9a-fA-F]{2}/.test(rawPassword)
    ? decodeURIComponent(rawPassword)
    : rawPassword;

  const [hostAndPort, database = "postgres"] = hostPart.split("/");
  const lastColon = hostAndPort.lastIndexOf(":");
  const host = lastColon === -1 ? hostAndPort : hostAndPort.slice(0, lastColon);
  const port = lastColon === -1 ? 5432 : Number(hostAndPort.slice(lastColon + 1));

  return {
    host,
    port,
    user,
    password,
    database: database.split("?")[0],
    ssl: { rejectUnauthorized: false },
  };
}

export async function connect(): Promise<Client> {
  const client = new Client(connectionConfig());
  await client.connect();
  return client;
}
