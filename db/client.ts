import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// neon-http driver: stateless HTTP, works in Vercel functions and Bun scripts alike.
// Accepts an explicit url so tests can point at DATABASE_URL_TEST.
export function makeDb(url = process.env.DATABASE_URL!) {
  return drizzle(neon(url), { schema });
}

export type Db = ReturnType<typeof makeDb>;

// Public SSR read path (data.ts), least-privilege: the SELECT-only `serve` role
// (DATABASE_URL_SERVE) when configured, else the owner connection. NEVER a writer —
// the serve role cannot INSERT/UPDATE/DELETE (Plan 1 review finding 3).
// Lazy, memoized. NEVER construct at module load: data.ts is reachable from client
// routes, and eager construction reads process.env + bundles neon into the client.
// Throws when USE_DB=1 but DATABASE_URL_SERVE is unset — the catch in data.ts degrades
// to static JSON and logs, so the throw surfaces the misconfiguration without a silent
// escalation to owner privileges.
let _db: Db | undefined;
export function getDb(): Db {
  // Guard precedes the ??= so a misconfigured startup never memoizes an owner connection.
  if (process.env.USE_DB === "1" && !process.env.DATABASE_URL_SERVE) {
    throw new Error("USE_DB=1 but DATABASE_URL_SERVE unset — refusing to serve as owner");
  }
  return (_db ??= makeDb(process.env.DATABASE_URL_SERVE ?? process.env.DATABASE_URL!));
}

// Writer path for operator scripts (backfill, materialize): the restricted `ingest`
// role (DATABASE_URL_INGEST) when configured, else owner. Distinct from getDb() so the
// public serve connection stays SELECT-only while writers retain INSERT/UPDATE.
// Not memoized (unlike getDb): one-shot scripts call it once, and skipping the cache keeps
// the writer connection out of the long-lived serverless instance state getDb lives in.
export function getWriteDb(): Db {
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL_INGEST) {
    console.warn(
      "DATABASE_URL_INGEST unset — writer running as owner (prices freeze not role-enforced)",
    );
  }
  return makeDb(process.env.DATABASE_URL_INGEST ?? process.env.DATABASE_URL!);
}
