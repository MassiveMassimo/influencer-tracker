import { siteUrl } from "#/og/site.ts";

// Defensive backstop for the API read routes. On Vercel the real control is the ISR
// `expiration` (6h) set by the vite routeRules (Task 3); this header only governs
// non-Vercel/other CDNs. stale-while-revalidate needs an explicit duration (RFC 5861) —
// Vercel/most CDNs ignore the bare directive, so SWR would never fire without =N.
export const CACHE_CONTROL = "public, max-age=0, s-maxage=21600, stale-while-revalidate=21600";

type MissMode =
  | { onMiss: "empty"; emptyBody: string }
  | { onMiss: "error"; label: string };

// Fetches the committed static CDN asset (public/... served from the edge) over HTTP — public/
// ships to the CDN, not the function filesystem on Vercel, so a node:fs read would 500 in prod.
// On a non-OK upstream: "empty" → 200 with emptyBody (prices); "error" → upstream status as JSON
// so callers calling res.json() always get JSON (an unknown handle is a clean 404, not a 500).
export async function staticFallback(path: string, opts: MissMode): Promise<Response> {
  const res = await fetch(siteUrl(path));
  if (!res.ok) {
    if (opts.onMiss === "empty") {
      return new Response(opts.emptyBody, {
        headers: { "Content-Type": "application/json", "Cache-Control": CACHE_CONTROL },
      });
    }
    return Response.json(
      { error: `${opts.label}: upstream ${res.status}` },
      { status: res.status, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }
  return new Response(await res.text(), {
    headers: { "Content-Type": "application/json", "Cache-Control": CACHE_CONTROL },
  });
}
