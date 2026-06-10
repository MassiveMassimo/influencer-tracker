import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // @visx ESM builds use extensionless internal imports that Node's SSR resolver
  // rejects; force Vite to bundle them for SSR so its resolver handles them.
  ssr: { noExternal: [/^@visx\//] },
  // nitro() builds the deployable server output. On Vercel it auto-detects the
  // platform (VERCEL env) and emits .vercel/output. OG rendering (satori + the
  // native @resvg/resvg-js addon) runs only in scripts/prebuild.ts at build time,
  // so it's deliberately not part of the app/server graph here.
  nitro: {
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
    },
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
})

export default config
