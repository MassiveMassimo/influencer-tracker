// Interlock for destructive DB tests. The env-gated db/*.test.ts + db-read.test.ts run
// TRUNCATE against DATABASE_URL_TEST. If that var is ever pointed at a production DB (a
// copy-paste slip), the tests would wipe production. Call this before any TRUNCATE so a
// misconfigured test branch fails loudly instead of destroying data.
//
// String equality is not enough: the pooled and direct (-pooler) hosts of the same Neon
// branch differ as strings, as do query-param/user variants, so we compare the Neon
// ENDPOINT ID (first hostname label, minus the -pooler suffix) against every known prod
// connection string.
function endpointId(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname; // e.g. ep-cool-name-123456[-pooler].us-east-2.aws.neon.tech
    return host.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return null;
  }
}

const PROD_URL_VARS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DATABASE_URL_SERVE",
  "DATABASE_URL_INGEST",
];

export function assertSeparateTestDb(): void {
  const test = process.env.DATABASE_URL_TEST;
  if (!test) throw new Error("DATABASE_URL_TEST unset — destructive test refused");
  const testEp = endpointId(test);
  if (!testEp) throw new Error("DATABASE_URL_TEST is not a valid connection string");
  for (const v of PROD_URL_VARS) {
    if (endpointId(process.env[v]) === testEp) {
      throw new Error(
        `DATABASE_URL_TEST shares a Neon endpoint with ${v} — tests TRUNCATE, so they must ` +
          "point at a separate Neon branch. Destructive setup refused.",
      );
    }
  }
}

// Mutation-probe tests (prices-immutable, serve-readonly) connect as a restricted role and
// assert writes are forbidden. Their payloads (UPDATE prices, DELETE creators) are
// prod-destructive if the role creds are misconfigured to an owner connection. Guard each
// suite by asserting the connection's actual role BEFORE any probe runs, so a misconfigured
// URL fails with zero writes. Pair with non-matching WHERE predicates for belt-and-braces.
export async function assertConnectedAs(
  sqlRole: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>,
  expected: string,
): Promise<void> {
  const rows = (await sqlRole`SELECT current_user AS u`) as { u: string }[];
  const actual = rows[0]?.u;
  if (actual !== expected) {
    throw new Error(
      `expected to connect as role "${expected}" but connected as "${actual}" — refusing to run ` +
        "mutation probes (creds likely point at the wrong role/DB).",
    );
  }
}
