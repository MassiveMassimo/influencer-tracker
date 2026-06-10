// Interlock for destructive DB tests. The env-gated db/*.test.ts + db-read.test.ts run
// TRUNCATE against DATABASE_URL_TEST. If that var is ever pointed at the prod DATABASE_URL
// (a copy-paste slip), the tests would wipe production. Call this before any TRUNCATE so a
// misconfigured test branch fails loudly instead of destroying data.
export function assertSeparateTestDb(): void {
  const test = process.env.DATABASE_URL_TEST;
  if (!test) throw new Error("DATABASE_URL_TEST unset — destructive test refused");
  if (test === process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL_TEST equals DATABASE_URL (prod) — tests TRUNCATE, so they must point at a " +
        "separate Neon test branch. Destructive setup refused.",
    );
  }
}
