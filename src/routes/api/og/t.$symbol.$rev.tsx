import { createFileRoute } from "@tanstack/react-router";
import { CACHE_CONTROL, isSafeAssetKey } from "#/lib/api-serve.ts";

// Dynamic cross-creator ticker OG card (the /t/<symbol> "all" view) with the symbol's
// price line-graph background. Two-param path, distinct from the 3-param
// /api/og/t/$handle/$symbol/$rev by segment count. ISR-cached; $rev busts the CDN on
// data change (page head() emits a new rev). $rev unused here.
export const Route = createFileRoute("/api/og/t/$symbol/$rev")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { symbol } = params;
        if (!isSafeAssetKey(symbol)) {
          return new Response("invalid", { status: 404 });
        }

        const { renderOgPng } = await import("#/og/render.tsx");
        const headers = { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL };

        try {
          const { fetchCallsIndex, fetchPrices } = await import("#/lib/data.ts");
          const { summarizeTicker } = await import("#/lib/call-filter.ts");
          const [calls, prices] = await Promise.all([fetchCallsIndex(), fetchPrices(symbol)]);
          const summary = summarizeTicker(calls, symbol);
          const png = await renderOgPng({
            kind: "ticker-all",
            theme: "dark",
            symbol,
            company: summary.company,
            creatorCount: summary.creatorCount,
            callCount: summary.callCount,
            avgExcess: summary.avgEx3m,
            closes: prices.map((p) => p.c),
          });
          return new Response(new Uint8Array(png), { headers });
        } catch (e) {
          console.warn(`[og ticker-all] ${symbol} render failed, minimal card`, e);
          const png = await renderOgPng({
            kind: "ticker-all",
            theme: "dark",
            symbol,
            creatorCount: 0,
            callCount: 0,
            avgExcess: null,
          });
          return new Response(new Uint8Array(png), { headers });
        }
      },
    },
  },
});
