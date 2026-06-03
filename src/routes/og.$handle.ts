import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderOgPng } from "#/og/render.tsx";
import { ogTheme } from "#/og/solar.ts";
import { pngResponse } from "./og[.]png";

interface IndexEntry {
  handle: string;
  name: string;
  totalCalls: number;
  avgExcess3m: number;
  avatar?: string;
}

async function loadIndex(): Promise<IndexEntry[]> {
  try {
    return JSON.parse(
      await readFile(join(process.cwd(), "data", "creators", "index.json"), "utf8"),
    );
  } catch {
    return [];
  }
}

// Served at /og/<handle> (extensionless — a .png suffix would corrupt the param
// name); the image/png Content-Type is what crawlers honor.
export const Route = createFileRoute("/og/$handle")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const theme = ogTheme();
        const entry = (await loadIndex()).find((c) => c.handle === params.handle);
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
