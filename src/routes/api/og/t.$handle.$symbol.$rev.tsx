import { createFileRoute } from "@tanstack/react-router";
import { CACHE_CONTROL, isSafeAssetKey } from "#/lib/api-serve.ts";

// Dynamic ticker OG card with the symbol's price line-graph background. ISR-cached;
// $rev busts the CDN cache on data change (page head() emits a new rev). $rev unused here.
export const Route = createFileRoute("/api/og/t/$handle/$symbol/$rev")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { handle, symbol } = params;
        if (!isSafeAssetKey(handle) || !isSafeAssetKey(symbol)) {
          return new Response("invalid", { status: 404 });
        }

        const { renderOgPng } = await import("#/og/render.tsx");
        const headers = { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL };

        try {
          const { fetchDataset, fetchPrices } = await import("#/lib/data.ts");
          const [ds, prices] = await Promise.all([fetchDataset(handle), fetchPrices(symbol)]);
          const calls = ds.calls.filter((c) => c.ticker === symbol);
          const png = await renderOgPng({
            kind: "ticker",
            theme: "dark",
            symbol,
            company: calls[0]?.company,
            name: ds.creator.name,
            handle,
            excess3m: calls[0]?.returns?.["3m"]?.excess ?? null,
            closes: prices.map((p) => p.c),
          });
          return new Response(new Uint8Array(png), { headers });
        } catch (e) {
          console.warn(`[og ticker] ${handle}/${symbol} render failed, minimal card`, e);
          const png = await renderOgPng({
            kind: "ticker",
            theme: "dark",
            symbol,
            name: handle,
            handle,
            excess3m: null,
          });
          return new Response(new Uint8Array(png), { headers });
        }
      },
    },
  },
});
