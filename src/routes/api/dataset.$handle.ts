import { createFileRoute } from "@tanstack/react-router";
import { readFromDbOrNull } from "#/lib/data.ts";
import { CACHE_CONTROL, staticFallback } from "#/lib/api-serve.ts";

// Cached read route for a creator's full dataset. DB-first under USE_DB=1 (Plan 3 cache lives
// in vite routeRules, Task 3); always-200 for a valid handle by falling back to the committed
// static CDN asset (/datasets/<h>.json) on any DB miss/null/error — the panic fallback.

export const Route = createFileRoute("/api/dataset/$handle")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const handle = params.handle;
        // SSR literal AT THE CALL SITE so Rollup DCE keeps neon/db modules out of any client
        // chunk (mirrors src/lib/data.ts); readFromDbOrNull adds the runtime USE_DB gate + log.
        if (import.meta.env.SSR) {
          const r = await readFromDbOrNull(`api dataset ${handle}`, async () => {
            const { getDb } = await import("../../../db/client");
            const { readDataset } = await import("#/lib/db-read.ts");
            return readDataset(getDb(), handle);
          });
          if (r != null) {
            return Response.json(r, { headers: { "Cache-Control": CACHE_CONTROL } });
          }
        }
        return staticFallback(`/datasets/${handle}.json`, {
          onMiss: "error",
          label: `dataset ${handle}`,
        });
      },
    },
  },
});
