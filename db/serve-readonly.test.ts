import { test, expect, describe, beforeAll } from "bun:test";
import { neon } from "@neondatabase/serverless";
import { assertConnectedAs } from "./test-db";

// Connects as the read-only serve role (DATABASE_URL_SERVE_TEST = serve creds at the
// TEST-branch host) and asserts every mutation is forbidden — the public SSR read path
// (getDb → DATABASE_URL_SERVE) must never be able to write the ledger.
const SERVE = process.env.DATABASE_URL_SERVE_TEST;
const REPORT = process.env.DATABASE_URL_REPORT_TEST;

describe.skipIf(!SERVE)("serve role is read-only", () => {
  // Construct only when running — bun still evaluates a skipped describe body.
  const sqlRole = SERVE ? neon(SERVE) : (undefined as unknown as ReturnType<typeof neon>);

  // Refuse to run the mutation probes unless we are genuinely connected as `serve`. If the
  // creds are misconfigured to an owner/prod connection, this throws BEFORE any write, so a
  // probe like `UPDATE prices` can never corrupt the frozen ledger. Probe predicates also
  // target a sentinel that matches no real row (permission denied fires at planning time).
  beforeAll(async () => {
    await assertConnectedAs(sqlRole, "serve");
  });

  // Wrap in an async IIFE: neon's tagged template returns a lazy NeonQueryPromise that
  // expect().rejects won't drive on its own — awaiting it inside a real Promise does.
  test("serve role can SELECT", async () => {
    const rows = (await sqlRole`SELECT count(*)::int AS n FROM creators`) as { n: number }[];
    expect(typeof rows[0].n).toBe("number");
  });

  test("serve role cannot INSERT into calls", async () => {
    await expect(
      (async () => {
        await sqlRole`INSERT INTO calls (handle, shortcode, ord, post_date, ticker, company, is_first_call, conviction, quote, returns) VALUES ('__perm_probe__','__perm_probe__',0,'2026-01-01','Z','Z',true,0,'q','{}')`;
      })(),
    ).rejects.toThrow(/permission denied/i);
  });

  test("serve role cannot UPDATE prices", async () => {
    await expect(
      (async () => {
        await sqlRole`UPDATE prices SET c = 0 WHERE symbol = '__perm_probe__'`;
      })(),
    ).rejects.toThrow(/permission denied/i);
  });

  test("serve role cannot DELETE creators", async () => {
    await expect(
      (async () => {
        await sqlRole`DELETE FROM creators WHERE handle = '__perm_probe__'`;
      })(),
    ).rejects.toThrow(/permission denied/i);
  });

  test("serve role cannot read call_overrides", async () => {
    await expect(
      (async () => {
        await sqlRole`SELECT 1 FROM call_overrides LIMIT 1`;
      })(),
    ).rejects.toThrow(/permission denied/i);
  });

  test("serve role cannot read call_reports", async () => {
    await expect(
      (async () => {
        await sqlRole`SELECT 1 FROM call_reports LIMIT 1`;
      })(),
    ).rejects.toThrow(/permission denied/i);
  });
});

// Connects as the INSERT-only report role and asserts SELECT is denied. The report
// role is used exclusively by /api/report — it must not be able to read the ledger.
describe.skipIf(!REPORT)("report role is INSERT-only on call_reports", () => {
  const sqlReport = REPORT ? neon(REPORT) : (undefined as unknown as ReturnType<typeof neon>);

  beforeAll(async () => {
    await assertConnectedAs(sqlReport, "report");
  });

  test("report role cannot SELECT call_reports", async () => {
    await expect(
      (async () => {
        await sqlReport`SELECT 1 FROM call_reports LIMIT 1`;
      })(),
    ).rejects.toThrow(/permission denied/i);
  });
});
