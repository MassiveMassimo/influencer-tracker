import { createFileRoute } from "@tanstack/react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { siteUrl } from "#/og/site.ts";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        let handles: string[] = [];
        try {
          const idx = JSON.parse(
            await readFile(join(process.cwd(), "data", "creators", "index.json"), "utf8"),
          ) as { handle: string }[];
          handles = idx.map((c) => c.handle);
        } catch {
          handles = [];
        }
        const urls = [siteUrl("/"), ...handles.map((h) => siteUrl(`/c/${h}`))];
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>`;
        return new Response(body, { headers: { "Content-Type": "application/xml" } });
      },
    },
  },
});
