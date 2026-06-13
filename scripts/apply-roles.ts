// scripts/apply-roles.ts — creates the restricted ingest (write) and serve (read-only)
// roles. Run once per environment (against DATABASE_URL) after migrations.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!); // admin/owner connection
const pw = process.env.INGEST_ROLE_PASSWORD!;
const servePw = process.env.SERVE_ROLE_PASSWORD!;
// DDL cannot use bind params, so validate each password against a safe charset and
// single-quote-escape it. Operator-supplied env vars, but never interpolate unchecked.
const SAFE_PW = /^[A-Za-z0-9_-]{16,}$/;
if (!SAFE_PW.test(pw)) {
  throw new Error("INGEST_ROLE_PASSWORD must be >=16 chars of [A-Za-z0-9_-]");
}
if (!SAFE_PW.test(servePw)) {
  throw new Error("SERVE_ROLE_PASSWORD must be >=16 chars of [A-Za-z0-9_-]");
}

async function main() {
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ingest') THEN
      CREATE ROLE ingest LOGIN;
    END IF;
  END $$`;
  // sql.unsafe() returns a FRAGMENT, not an executor — use sql.query() to actually run DDL.
  await sql.query(`ALTER ROLE ingest PASSWORD '${pw.replaceAll("'", "''")}'`);
  await sql`GRANT INSERT, SELECT ON prices TO ingest`;
  await sql`REVOKE UPDATE, DELETE ON prices FROM ingest`;
  await sql`GRANT INSERT, UPDATE, SELECT ON creators, calls TO ingest`;
  // Materialized serve artifacts (Plan 2) — ingest upserts them at the end of a run.
  await sql`GRANT INSERT, UPDATE, SELECT ON artifacts TO ingest`;
  // Override store: ingest reads (score) + writes (apply-override.ts) it.
  await sql`GRANT INSERT, UPDATE, SELECT ON call_overrides TO ingest`;
  console.log("ingest role configured: prices insert-only.");

  // Read-only serve role: the public SSR path (getDb → DATABASE_URL_SERVE) connects as
  // this. SELECT only on every table — no INSERT/UPDATE/DELETE, so a compromised serve
  // path cannot mutate the ledger (Plan 1 review finding 3).
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'serve') THEN
      CREATE ROLE serve LOGIN;
    END IF;
  END $$`;
  await sql.query(`ALTER ROLE serve PASSWORD '${servePw.replaceAll("'", "''")}'`);
  // Undo the previously-applied auto-grant (older script versions ran ALTER DEFAULT PRIVILEGES);
  // Plan 4 adds tables the serve role must not see, so serve gets explicit grants only.
  await sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM serve`;
  await sql`GRANT SELECT ON creators, calls, prices, artifacts TO serve`;
  await sql`REVOKE INSERT, UPDATE, DELETE ON creators, calls, prices, artifacts FROM serve`;
  // call_overrides is operator-only correction data — serve must never see it.
  await sql`REVOKE ALL ON call_overrides FROM serve`;
  console.log("serve role configured: SELECT-only.");
}
main();
