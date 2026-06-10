import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// neon-http driver: stateless HTTP, works in Vercel functions and Bun scripts alike.
// Accepts an explicit url so tests can point at DATABASE_URL_TEST.
export function makeDb(url = process.env.DATABASE_URL!) {
  return drizzle(neon(url), { schema });
}

export type Db = ReturnType<typeof makeDb>;

// Lazy, memoized. NEVER construct at module load: data.ts is reachable from client
// routes, and eager construction reads process.env + bundles neon into the client.
let _db: Db | undefined;
export function getDb(): Db {
  return (_db ??= makeDb());
}
