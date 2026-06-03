import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderOgPng } from "#/og/render.tsx";
import { ogTheme } from "#/og/solar.ts";
import { pngResponse } from "./og[.]png";
import type { Dataset } from "#/lib/types.ts";

// Served at /og/<handle>/<symbol> (extensionless, see og.$handle.ts).
export const Route = createFileRoute("/og/$handle/$symbol")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const theme = ogTheme();
        let ds: Dataset | null = null;
        try {
          ds = JSON.parse(
            await readFile(
              join(process.cwd(), "data", "creators", params.handle, "dataset.json"),
              "utf8",
            ),
          );
        } catch {
          ds = null;
        }
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
