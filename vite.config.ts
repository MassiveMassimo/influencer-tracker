import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // @resvg/resvg-js is a native .node addon (used by the /api/og/* OG routes via
  // src/og/render.tsx). The dev dep-optimizer can't pre-bundle a native binary, so
  // exclude it; it loads fine at runtime in the Node server.
  optimizeDeps: { exclude: ['@resvg/resvg-js'] },
  // @visx ESM builds use extensionless internal imports that Node's SSR resolver
  // rejects; force Vite to bundle them for SSR so its resolver handles them.
  ssr: { noExternal: [/^@visx\//] },
  // nitro() builds the deployable server output. On Vercel it auto-detects the
  // platform (VERCEL env) and emits .vercel/output. OG rendering (satori + the
  // native @resvg/resvg-js addon) runs in scripts/prebuild.ts (home card, build
  // time) AND in the dynamic /api/og/* server routes (creator + ticker, request
  // time, ISR-cached).
  nitro: {
    vercel: {
      // On-demand ISR revalidation: Nitro bakes this into each isr route's
      // .prerender-config.json. The VM's revalidate-creator.ts then GETs a path with
      // `x-prerender-revalidate: <token>` to bust it instantly (else the 6h TTL governs).
      // Reuses REVALIDATE_TOKEN (build-time env); unset → no token written → TTL-only.
      config: { version: 3, bypassToken: process.env.REVALIDATE_TOKEN },
    },
    // RFC 8288 Link header on the homepage for agent discovery — advertises the
    // sitemap and the llms.txt index in the HTTP response (no markup parse needed).
    routeRules: {
      '/': {
        headers: {
          Link: '</sitemap.xml>; rel="sitemap", </llms.txt>; rel="llms-txt"',
        },
      },
      // PostHog reverse proxy — route analytics through our own origin so
      // ad/tracker blockers (which blocklist *.i.posthog.com) can't drop events.
      // Plain proxy rules compile to CDN-level rewrites on Vercel (no function
      // invocation). Two upstreams: static assets vs ingestion. Keep the /static
      // rule first — it's the more specific match. See analytics.tsx (api_host).
      '/relay/static/**': { proxy: 'https://us-assets.i.posthog.com/static/**' },
      '/relay/**': { proxy: 'https://us.i.posthog.com/**' },
      // 6h ISR revalidation on Vercel — serve API and SSR pages from the edge,
      // revalidated in the background after the TTL elapses. Use isr (timed),
      // not swr: the Nitro→Vercel adapter compiles swr to expiration:false
      // (cache forever), silently dropping the TTL.
      '/api/dataset/**': { isr: 21600 },
      '/api/prices/**': { isr: 21600 },
      '/api/calls-index': { isr: 21600 },
      '/api/og/**': { isr: 21600 },
      '/c/**': { isr: 21600 },
      '/t/**': { isr: 21600 },
      '/explore': { isr: 21600 },
    },
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
})

export default config
