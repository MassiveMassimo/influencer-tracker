import { createFileRoute } from "@tanstack/react-router";
import { renderOgPng } from "#/og/render.tsx";
import { ogTheme } from "#/og/solar.ts";
import { loadIndex } from "#/lib/dataset-source.ts";
import { pngResponse } from "./og[.]png";

// Served at /og/<handle> (extensionless — a .png suffix would corrupt the param
// name); the image/png Content-Type is what crawlers honor.
export const Route = createFileRoute("/og/$handle")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const theme = ogTheme();
        const entry = loadIndex().find((c) => c.handle === params.handle);
        // Fall back to the home card so embeds never break on an unknown handle.
        if (!entry) {
          return pngResponse(await renderOgPng({ kind: "home", theme }));
        }
        return pngResponse(
          await renderOgPng({
            kind: "creator",
            theme,
            name: entry.name,
            handle: entry.handle,
            avatar: entry.avatar,
            excess3m: entry.avgExcess3m,
            totalCalls: entry.totalCalls,
          }),
        );
      },
    },
  },
});
