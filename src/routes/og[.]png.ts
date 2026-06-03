import { createFileRoute } from "@tanstack/react-router";
import { renderOgPng } from "#/og/render.tsx";
import { ogTheme } from "#/og/solar.ts";

export function pngResponse(buf: Buffer): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/png",
      // Short TTL so re-crawls can pick up the day/night flip; crawlers may cache longer.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}

export const Route = createFileRoute("/og.png")({
  server: {
    handlers: {
      GET: async () => pngResponse(await renderOgPng({ kind: "home", theme: ogTheme() })),
    },
  },
});
