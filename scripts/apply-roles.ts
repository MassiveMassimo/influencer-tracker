// scripts/apply-roles.ts — creates the restricted ingest role and revokes mutation on
// `prices`. Run once per environment (against DATABASE_URL) after migrations.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!); // admin/owner connection
const pw = process.env.INGEST_ROLE_PASSWORD!;
// DDL cannot use bind params, so validate the password against a safe charset and
// single-quote-escape it. Operator-supplied env var, but never interpolate unchecked.
if (!/^[A-Za-z0-9_-]{16,}$/.test(pw)) {
  throw new Error("INGEST_ROLE_PASSWORD must be >=16 chars of [A-Za-z0-9_-]");
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
  console.log("ingest role configured: prices insert-only.");
}
main();
