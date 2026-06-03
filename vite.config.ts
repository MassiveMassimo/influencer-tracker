import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

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
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
