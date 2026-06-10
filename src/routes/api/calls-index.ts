import { createFileRoute } from "@tanstack/react-router";
import { readFromDbOrNull } from "#/lib/data.ts";
import { CACHE_CONTROL, staticFallback } from "#/lib/api-serve.ts";

// Cached read route for the slim cross-creator calls index. DB-first under USE_DB=1 (the
// artifacts table, Plan 3); always-200 by falling back to the committed static CDN asset
// (/calls-index.json) on any DB miss/null/error — the panic fallback.

export const Route = createFileRoute("/api/calls-index")({
  server: {
    handlers: {
      GET: async () => {
        // SSR literal AT THE CALL SITE so Rollup DCE keeps neon/db modules out of any client
        // chunk (mirrors src/lib/data.ts); readFromDbOrNull adds the runtime USE_DB gate + log.
        if (import.meta.env.SSR) {
          const r = await readFromDbOrNull("api calls-index", async () => {
            const { getDb } = await import("../../../db/client");
            const { readCallsIndex } = await import("#/lib/db-read.ts");
            return readCallsIndex(getDb());
          });
          if (r != null) {
            return Response.json(r, { headers: { "Cache-Control": CACHE_CONTROL } });
          }
        }
        return staticFallback("/calls-index.json", { onMiss: "error", label: "calls-index" });
      },
    },
  },
});
