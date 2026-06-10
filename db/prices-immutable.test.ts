import { test, expect, describe, beforeAll } from "bun:test";
import { neon } from "@neondatabase/serverless";
import { assertConnectedAs } from "./test-db";

// Connects as the restricted ingest role (DATABASE_URL_INGEST_TEST = ingest creds at the
// TEST-branch host) and asserts UPDATE/DELETE on prices are forbidden.
const INGEST = process.env.DATABASE_URL_INGEST_TEST;

describe.skipIf(!INGEST)("prices immutability", () => {
  // Construct only when running — bun still evaluates a skipped describe body.
  const sqlRole = INGEST ? neon(INGEST) : (undefined as unknown as ReturnType<typeof neon>);

  // Refuse the mutation probes unless genuinely connected as `ingest`. If the creds are
  // misconfigured to an owner/prod connection, `UPDATE prices SET c = 0` would succeed and
  // zero out the frozen ledger — assert the role first so a misconfig fails with zero writes.
  // Probes also target a sentinel symbol that matches no real row (permission denied fires
  // at planning time regardless).
  beforeAll(async () => {
    await assertConnectedAs(sqlRole, "ingest");
  });

  // Wrap in an async IIFE: neon's tagged template returns a lazy NeonQueryPromise that
  // expect().rejects won't drive on its own — awaiting it inside a real Promise does.
  test("ingest role cannot UPDATE prices", async () => {
    await expect((async () => { await sqlRole`UPDATE prices SET c = 0 WHERE symbol = '__perm_probe__'`; })())
      .rejects.toThrow(/permission denied/i);
  });

  test("ingest role cannot DELETE prices", async () => {
    await expect((async () => { await sqlRole`DELETE FROM prices WHERE symbol = '__perm_probe__'`; })())
      .rejects.toThrow(/permission denied/i);
  });
});
