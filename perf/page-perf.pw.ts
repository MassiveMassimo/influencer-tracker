import { test, expect } from '@playwright/test'
import {
  BUDGETS,
  ROUTES,
  logTable,
  pagePerfInit,
  readPagePerf,
  switchTimeframes,
  writeReport,
} from './helpers'

// Production build (nitro node server). Realistic Core Web Vitals, bundle
// transfer, long tasks, and Long Animation Frames per route.
test.describe('page performance (prod build)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(pagePerfInit)
  })

  for (const [name, path] of Object.entries(ROUTES)) {
    test(`load metrics — ${name}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'load' })
      // let LCP settle + above-fold work flush
      await page.waitForTimeout(2500)

      const m = await readPagePerf(page)
      logTable(`${name} (${path})`, {
        TTFB: `${m.ttfb} ms`,
        FCP: `${m.fcp} ms`,
        LCP: `${m.lcp} ms`,
        CLS: m.cls.toFixed(3),
        DOMContentLoaded: `${m.domContentLoaded} ms`,
        load: `${m.load} ms`,
        'JS transfer': `${m.transferKB.js} KB`,
        'CSS transfer': `${m.transferKB.css} KB`,
        'total transfer': `${m.transferKB.total} KB`,
        longTasks: `${m.longTasks.count} (${m.longTasks.total.toFixed(0)} ms, max ${m.longTasks.max.toFixed(0)})`,
        LoAF: `${m.loaf.count} (maxBlocking ${m.loaf.maxBlocking.toFixed(0)} ms)`,
      })
      writeReport(`page-prod__${name}`, { path, ...m })

      expect.soft(m.lcp, `${name} LCP`).toBeLessThan(BUDGETS.lcpMs)
      expect.soft(m.fcp, `${name} FCP`).toBeLessThan(BUDGETS.fcpMs)
      expect.soft(m.ttfb, `${name} TTFB`).toBeLessThan(BUDGETS.ttfbMs)
      expect.soft(m.cls, `${name} CLS`).toBeLessThan(BUDGETS.cls)
      expect.soft(m.transferKB.js, `${name} JS transfer`).toBeLessThan(BUDGETS.jsTransferKB)
      expect.soft(m.transferKB.total, `${name} total transfer`).toBeLessThan(BUDGETS.totalTransferKB)
    })
  }

  test('interaction jank — ticker timeframe switching', async ({ page }) => {
    await page.goto(ROUTES.ticker, { waitUntil: 'load' })
    await page.getByRole('tab', { name: '1M', exact: true }).first().waitFor({ timeout: 30000 })
    // reset accumulators so we measure interaction-time jank, not load-time
    await page.evaluate(() => {
      const s = (window as any).__pp
      s.longTasks = { count: 0, total: 0, max: 0 }
      s.loaf = { count: 0, total: 0, maxBlocking: 0 }
    })

    await switchTimeframes(page, ['1M', '1D', '1Y', '1W', '3M', 'All', '6M', '1M'])
    const m = await readPagePerf(page)

    logTable('ticker interaction jank', {
      longTasks: `${m.longTasks.count} (${m.longTasks.total.toFixed(0)} ms total, max ${m.longTasks.max.toFixed(0)} ms)`,
      LoAF: `${m.loaf.count} (maxBlocking ${m.loaf.maxBlocking.toFixed(0)} ms)`,
    })
    writeReport('page-prod__interaction-jank', {
      longTasks: m.longTasks,
      loaf: m.loaf,
    })

    expect.soft(m.longTasks.total, 'interaction long-task total').toBeLessThan(BUDGETS.longTaskTotalMs)
    expect.soft(m.loaf.maxBlocking, 'interaction LoAF max blocking').toBeLessThan(BUDGETS.loafMaxBlockingMs)
  })
})
