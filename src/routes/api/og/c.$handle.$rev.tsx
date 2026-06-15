import { createFileRoute } from "@tanstack/react-router";
import { readFromDbOrNull } from "#/lib/data.ts";
import { CACHE_CONTROL, isSafeAssetKey } from "#/lib/api-serve.ts";
import type { IndexEntry } from "#/lib/dataset-source.ts";

// satori needs inline image bytes — a /avatars/<h>.<ext> CDN path won't resolve inside
// the renderer. Resolve to a data URI at request time. Robust to the legacy inline
// data-URI form (passed through), so it works before/after the prod DB avatar migration.
async function resolveAvatar(avatar: string | undefined): Promise<string | undefined> {
  if (!avatar) return undefined;
  if (avatar.startsWith("data:")) return avatar; // legacy inline form
  if (!avatar.startsWith("/")) return undefined;
  try {
    const { siteUrl } = await import("#/og/site.ts");
    const res = await fetch(siteUrl(avatar));
    if (!res.ok) return undefined;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return `data:${mime};base64,${b64}`;
  } catch { return undefined; }
}

// Dynamic creator OG card. ISR-cached (vite routeRules); the $rev path segment busts
// the CDN cache when stats change (the page head() emits a new rev). $rev is unused here.
export const Route = createFileRoute("/api/og/c/$handle/$rev")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { handle } = params;
        if (!isSafeAssetKey(handle)) {
          return new Response("invalid handle", { status: 404 });
        }

        let entry: IndexEntry | undefined;
        // SSR literal at the call site so Rollup DCE keeps neon/db out of any client chunk.
        if (import.meta.env.SSR) {
          const idx = await readFromDbOrNull(`og index ${handle}`, async () => {
            const { getDb } = await import("../../../../db/client");
            const { readIndex } = await import("#/lib/db-read.ts");
            return readIndex(getDb());
          });
          entry = idx?.find((e) => e.handle === handle);
        }
        if (!entry) {
          const { loadIndex } = await import("#/lib/dataset-source.ts");
          entry = loadIndex().find((e) => e.handle === handle);
        }

        const { renderOgPng } = await import("#/og/render.tsx");
        const avatar = entry ? await resolveAvatar(entry.avatar) : undefined;
        const png = await renderOgPng(
          entry
            ? {
                kind: "creator",
                theme: "dark",
                name: entry.name,
                handle,
                avatar,
                excess3m: entry.avgExcess3m,
                totalCalls: entry.totalCalls,
              }
            : { kind: "home", theme: "dark" }, // unknown handle: minimal branded card, never 500
        );
        return new Response(new Uint8Array(png), {
          headers: { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL },
        });
      },
    },
  },
});
