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
  // @resvg/resvg-js ships a native .node addon the bundler can't load — keep it
  // external so it's required at runtime (used by the OG image routes).
  ssr: { noExternal: [/^@visx\//], external: ["@resvg/resvg-js"] },
  // Keep the native addon out of the dep-optimizer scan too (it can't parse .node).
  optimizeDeps: { exclude: ["@resvg/resvg-js"] },
  // nitro() builds the deployable server output. On Vercel it auto-detects the
  // platform (VERCEL env) and emits .vercel/output. resvg-js is externalized; the
  // "@resvg/resvg-js*" prefix traces both the JS package and its platform-specific
  // .node binary (e.g. @resvg/resvg-js-linux-x64-gnu) into the function so the OG
  // routes can require the native addon at runtime.
  nitro: {
    traceDeps: ["@resvg/resvg-js*"],
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
})

export default config
