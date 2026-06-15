import { createFileRoute } from "@tanstack/react-router";
import { readFromDbOrNull } from "#/lib/data.ts";
import { CACHE_CONTROL, isSafeAssetKey } from "#/lib/api-serve.ts";
import type { IndexEntry } from "#/lib/dataset-source.ts";

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
        const png = await renderOgPng(
          entry
            ? {
                kind: "creator",
                theme: "dark",
                name: entry.name,
                handle,
                avatar: entry.avatar,
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
