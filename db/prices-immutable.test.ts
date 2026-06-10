import { test, expect, describe } from "bun:test";
import { neon } from "@neondatabase/serverless";

// Connects as the restricted ingest role (DATABASE_URL_INGEST_TEST = ingest creds at the
// TEST-branch host) and asserts UPDATE/DELETE on prices are forbidden.
const INGEST = process.env.DATABASE_URL_INGEST_TEST;

describe.skipIf(!INGEST)("prices immutability", () => {
  // Construct only when running — bun still evaluates a skipped describe body.
  const sqlRole = INGEST ? neon(INGEST) : (undefined as unknown as ReturnType<typeof neon>);

  // Wrap in an async IIFE: neon's tagged template returns a lazy NeonQueryPromise that
  // expect().rejects won't drive on its own — awaiting it inside a real Promise does.
  test("ingest role cannot UPDATE prices", async () => {
    await expect((async () => { await sqlRole`UPDATE prices SET c = 0 WHERE symbol = 'SPY'`; })())
      .rejects.toThrow(/permission denied/i);
  });

  test("ingest role cannot DELETE prices", async () => {
    await expect((async () => { await sqlRole`DELETE FROM prices WHERE symbol = 'SPY'`; })())
      .rejects.toThrow(/permission denied/i);
  });
});
