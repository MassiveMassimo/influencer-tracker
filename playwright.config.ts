import { defineConfig, devices } from '@playwright/test'

// Two projects, two servers:
//  • render-dev → vite dev (React profiling on, readable component names) for
//    the per-component re-render counts. Dev numbers only — not real-world perf.
//  • page-prod  → production build served by the nitro node server (realistic
//    Core Web Vitals, bundle transfer, jank, memory). Minified, profiling off.
// Ports 3100/3200 avoid colliding with a dev server already on 3000.

const DEV_PORT = 3100
const PROD_PORT = 3200

export default defineConfig({
  testDir: './perf',
  testMatch: /\.pw\.ts$/, // decoupled from bun test (which claims *.spec.ts / *.test.ts)
  fullyParallel: false,
  workers: 1, // perf numbers must not contend for CPU
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  projects: [
    {
      name: 'render-dev',
      testMatch: /render-churn\.pw\.ts/,
      use: { baseURL: `http://localhost:${DEV_PORT}`, ...devices['Desktop Chrome'] },
    },
    {
      name: 'page-prod',
      testMatch: /(page-perf|memory)\.pw\.ts/,
      use: {
        baseURL: `http://localhost:${PROD_PORT}`,
        ...devices['Desktop Chrome'],
        // expose window.gc + precise heap reads for the memory-leak test
        launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] },
      },
    },
  ],
  webServer: [
    {
      command: `bunx vite dev --port ${DEV_PORT}`,
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // build once, then serve the nitro node output (prod SSR)
      command: `bun run build && PORT=${PROD_PORT} node .output/server/index.mjs`,
      url: `http://localhost:${PROD_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
