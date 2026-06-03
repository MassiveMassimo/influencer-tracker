import { createFileRoute } from "@tanstack/react-router";
import { renderOgPng } from "#/og/render.tsx";
import { ogTheme } from "#/og/solar.ts";
import { loadDatasetRaw } from "#/lib/dataset-source.ts";
import { pngResponse } from "./og[.]png";
import type { Dataset } from "#/lib/types.ts";

// Served at /og/<handle>/<symbol> (extensionless, see og.$handle.ts).
export const Route = createFileRoute("/og/$handle/$symbol")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const theme = ogTheme();
        const raw = await loadDatasetRaw(params.handle);
        const ds: Dataset | null = raw ? (JSON.parse(raw) as Dataset) : null;
        if (!ds) return pngResponse(await renderOgPng({ kind: "home", theme }));
        const calls = ds.calls.filter((c) => c.ticker === params.symbol);
        const excess3m = calls[0]?.returns["3m"]?.excess ?? null;
        return pngResponse(
          await renderOgPng({
            kind: "ticker",
            theme,
            symbol: params.symbol,
            company: calls[0]?.company,
            name: ds.creator.name,
            handle: ds.creator.handle,
            excess3m,
          }),
        );
      },
    },
  },
});
