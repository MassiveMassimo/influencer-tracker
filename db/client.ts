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
let _db: Db | undefined;
export function getDb(): Db {
  return (_db ??= makeDb(process.env.DATABASE_URL_SERVE ?? process.env.DATABASE_URL!));
}

// Writer path for operator scripts (backfill, materialize): the restricted `ingest`
// role (DATABASE_URL_INGEST) when configured, else owner. Distinct from getDb() so the
// public serve connection stays SELECT-only while writers retain INSERT/UPDATE.
export function getWriteDb(): Db {
  return makeDb(process.env.DATABASE_URL_INGEST ?? process.env.DATABASE_URL!);
}
