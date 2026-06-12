import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

// Token-guarded revalidate/purge seam for Plan 3b's VM ingest. After a data update the
// ingester POSTs the changed paths/tags here to bust the CDN-cached entries (the page +
// /api/* routes carry routeRules.swr: 21600 → Vercel edge cache). In Plan 3a this is
// operator-callable and auth-tested only; there is no ingest caller yet.
//
// Auth: a single shared secret in `Authorization: Bearer <token>` compared to
// REVALIDATE_TOKEN. If the env var is unset the route is misconfigured and returns 503 —
// an unset secret must never mean "open", since an unguarded purge is a DoS lever.
// Missing/mismatched token → 401.

// On the stack we run (Nitro → Vercel Build Output), `routeRules.swr` compiles to a
// CDN-level `s-maxage`+stale-while-revalidate, NOT a Nitro `defineCachedEventHandler`
// entry. So Nitro's `useStorage("cache").removeItem(...)` would be a no-op here — it only
// busts Nitro-internal cached handlers, which these routes are not. A real per-path CDN
// purge on Vercel needs the Vercel REST API with a project-scoped token. That token lives
// with the VM ingester, so the actual purge call is Plan 3b wiring.
//
// TODO(plan-3b): wire the real CDN purge from the VM ingester. With a VERCEL_API_TOKEN +
// VERCEL_PROJECT_ID (and VERCEL_TEAM_ID if team-scoped), call Vercel's purge endpoint per
// path/tag. Until then `purge` records intent and returns the count it would have purged;
// it deliberately does not claim to have busted the CDN.
async function purge(
  paths: string[],
  tags: string[],
): Promise<{ paths: number; tags: number }> {
  // No real CDN purge available in 3a (see TODO above). Log the intent so an operator
  // calling this manually can confirm the seam fired, then report what was requested.
  if (paths.length || tags.length) {
    console.log(
      `[revalidate] purge requested — paths: ${JSON.stringify(paths)} tags: ${JSON.stringify(tags)} (3a: no-op, awaiting plan-3b Vercel API wiring)`,
    );
  }
  return { paths: paths.length, tags: tags.length };
}

// Constant-time, length-independent compare: pad both to a fixed width so neither the
// comparison time nor the buffer size leaks the token length. Server-only route (Nitro Node
// function, never client-bundled), so node:crypto is safe to import.
function safeCompare(a: string, b: string): boolean {
  const len = Math.max(Buffer.byteLength(a), Buffer.byteLength(b), 32);
  const bufA = Buffer.alloc(len);
  const bufB = Buffer.alloc(len);
  bufA.write(a);
  bufB.write(b);
  return timingSafeEqual(bufA, bufB);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

export const Route = createFileRoute("/api/revalidate")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const expected = process.env.REVALIDATE_TOKEN;
        // Misconfigured: refuse rather than allow an unguarded purge.
        if (!expected) {
          return Response.json(
            { error: "revalidate seam not configured (REVALIDATE_TOKEN unset)" },
            { status: 503 },
          );
        }
        const provided = bearerToken(request);
        if (!provided || !safeCompare(provided, expected)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        // Body is optional/best-effort; an empty or malformed body purges nothing.
        let paths: string[] = [];
        let tags: string[] = [];
        try {
          const body = (await request.json()) as { paths?: unknown; tags?: unknown };
          if (Array.isArray(body?.paths)) paths = body.paths.filter((p): p is string => typeof p === "string");
          if (Array.isArray(body?.tags)) tags = body.tags.filter((t): t is string => typeof t === "string");
        } catch {
          // No JSON body — treat as a no-op purge request.
        }

        const result = await purge(paths, tags);
        return Response.json({ ok: true, purged: result });
      },
    },
  },
});
