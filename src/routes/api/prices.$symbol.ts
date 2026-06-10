import { createFileRoute } from "@tanstack/react-router";
import { readFromDbOrNull } from "#/lib/data.ts";
import { CACHE_CONTROL, staticFallback } from "#/lib/api-serve.ts";

// Cached read route for a ticker's baked daily OHLC. DB-first under USE_DB=1; always-200 for a
// valid symbol by falling back to the committed static CDN asset (/prices/<SYMBOL>.json) on
// any DB miss/null/error — the panic fallback.

export const Route = createFileRoute("/api/prices/$symbol")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const symbol = params.symbol;
        // SSR literal AT THE CALL SITE so Rollup DCE keeps neon/db modules out of any client
        // chunk (mirrors src/lib/data.ts); readFromDbOrNull adds the runtime USE_DB gate + log.
        if (import.meta.env.SSR) {
          const r = await readFromDbOrNull(`api prices ${symbol}`, async () => {
            const { getDb } = await import("../../../db/client");
            const { readPrices } = await import("#/lib/db-read.ts");
            return readPrices(getDb(), symbol);
          });
          // Fall through to static if the DB returned an empty array (symbol not yet in DB).
          if (r != null && r.length) {
            return Response.json(r, { headers: { "Cache-Control": CACHE_CONTROL } });
          }
        }
        // On a miss, mirror fetchPrices: serve an empty array rather than throw.
        return staticFallback(`/prices/${symbol}.json`, { onMiss: "empty", emptyBody: "[]" });
      },
    },
  },
});
