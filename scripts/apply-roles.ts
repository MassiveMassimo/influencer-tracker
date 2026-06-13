// scripts/apply-roles.ts — creates the restricted ingest (write), serve (read-only),
// and report (INSERT-only on call_reports) roles.
// Run once per environment (against DATABASE_URL) after migrations.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!); // admin/owner connection
const pw = process.env.INGEST_ROLE_PASSWORD!;
const servePw = process.env.SERVE_ROLE_PASSWORD!;
const reportPw = process.env.REPORT_ROLE_PASSWORD!;
// DDL cannot use bind params, so validate each password against a safe charset and
// single-quote-escape it. Operator-supplied env vars, but never interpolate unchecked.
const SAFE_PW = /^[A-Za-z0-9_-]{16,}$/;
if (!SAFE_PW.test(pw)) {
  throw new Error("INGEST_ROLE_PASSWORD must be >=16 chars of [A-Za-z0-9_-]");
}
if (!SAFE_PW.test(servePw)) {
  throw new Error("SERVE_ROLE_PASSWORD must be >=16 chars of [A-Za-z0-9_-]");
}
if (!SAFE_PW.test(reportPw)) {
  throw new Error("REPORT_ROLE_PASSWORD must be >=16 chars of [A-Za-z0-9_-]");
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
  // Report queue: ingest reads submitted reports for the review UI (Task 13).
  await sql`GRANT SELECT ON call_reports TO ingest`;
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
  // call_reports is the public report inbox — serve has no legitimate read path.
  await sql`REVOKE ALL ON call_reports FROM serve`;
  console.log("serve role configured: SELECT-only.");

  // INSERT-only report role: the public /api/report endpoint connects as this.
  // Can submit new reports — cannot read the ledger, read prior reports, or touch
  // any other table. A compromised public endpoint is fully blast-radius-contained.
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'report') THEN
      CREATE ROLE report LOGIN;
    END IF;
  END $$`;
  await sql.query(`ALTER ROLE report PASSWORD '${reportPw.replaceAll("'", "''")}'`);
  // INSERT-only on call_reports, nothing else. A compromised public endpoint can neither
  // read the ledger nor the reports (no SELECT) nor write any other table.
  await sql`GRANT INSERT ON call_reports TO report`;
  await sql`REVOKE SELECT, UPDATE, DELETE ON call_reports FROM report`;
  // NOTE: if INSERTs ever fail with a sequence permission error, add:
  //   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO report
  // Identity columns on modern Postgres are covered by the table-level INSERT grant,
  // so this grant is intentionally omitted unless proven necessary.
  console.log("report role configured: INSERT-only on call_reports.");
}
main();
