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
  nitro: {},
  plugins: [devtools(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
})

export default config
