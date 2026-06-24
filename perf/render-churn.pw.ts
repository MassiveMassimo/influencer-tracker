import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import {
  BUDGETS,
  ROUTES,
  logTable,
  readRender,
  renderCounterInit,
  resetRender,
  switchTimeframes,
  writeReport,
} from './helpers'

// react-scan's pre-mount hook installer. Loaded before any app script so React
// records per-fiber actualDuration (the dev build does not otherwise).
const require = createRequire(import.meta.url)
const INSTALL_HOOK = require.resolve('react-scan/dist/install-hook.global.js')

test.describe('render churn (dev build, profiling on)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ path: INSTALL_HOOK })
    await page.addInitScript(renderCounterInit)
  })

  test('ticker timeframe switching', async ({ page }) => {
    await page.goto(ROUTES.ticker, { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: '1M', exact: true }).first().waitFor({ timeout: 30000 })
    await page.waitForTimeout(3000) // let load-time fetches/animations drain before measuring

    const SEQ = ['1M', '1D', '1Y', '1W', '3M', 'All', '6M', '1M', '1Y', '1D', '3M', '1W']
    await resetRender(page)
    await switchTimeframes(page, SEQ, 800) // 800ms lets each candle/area morph finish

    const r = await readRender(page)
    const totalRenders = Object.values(r.counts).reduce((a, b) => a + b, 0)
    const top = Object.entries(r.counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
    const perSwitch = +(totalRenders / SEQ.length).toFixed(1)

    logTable('ticker timeframe switch — renders', {
      switches: SEQ.length,
      commits: r.commits,
      'commits/switch': +(r.commits / SEQ.length).toFixed(1),
      totalRenderEvents: totalRenders,
      'renders/switch': perSwitch,
      profilingActive: r.sawDur,
      'top components': '',
      ...Object.fromEntries(top.map(([k, v]) => [`  ${k}`, v])),
    })
    writeReport('render-dev__ticker-timeframe', { perSwitch, ...r, top })

    // profiling must be active or the counts are meaningless
    expect(r.sawDur, 'react-scan profiling not active — actualDuration never set').toBe(true)
    expect.soft(perSwitch, 'renders/switch over budget').toBeLessThan(BUDGETS.rendersPerSwitch)
    expect
      .soft(r.commits / SEQ.length, 'commits/switch over budget')
      .toBeLessThan(BUDGETS.commitsPerSwitch)
  })

  // TODO: creator-switch morph test — needs a reliable CreatorSwitcher selector
  // (tab↔combobox layer swap). Timeframe switching above already exercises the
  // candle/area morph render cost, so this is deferred, not blocking.
})
