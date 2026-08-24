import { test, expect } from "@playwright/test";
import {
  BUDGETS,
  ROUTES,
  logTable,
  pagePerfInit,
  readPagePerf,
  switchTimeframes,
  writeReport,
} from "./helpers";

// Production build (nitro node server). Realistic Core Web Vitals, bundle
// transfer, long tasks, and Long Animation Frames per route.
test.describe("page performance (prod build)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(pagePerfInit);
  });

  for (const [name, path] of Object.entries(ROUTES)) {
    test(`load metrics — ${name}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "load" });
      // let LCP settle + above-fold work flush
      await page.waitForTimeout(2500);

      const m = await readPagePerf(page);
      logTable(`${name} (${path})`, {
        TTFB: `${m.ttfb} ms`,
        FCP: `${m.fcp} ms`,
        LCP: `${m.lcp} ms`,
        CLS: m.cls.toFixed(3),
        DOMContentLoaded: `${m.domContentLoaded} ms`,
        load: `${m.load} ms`,
        "DOM nodes": m.domNodes,
        "JS heap": `${m.heapMB} MB`,
        "HTML transfer": `${m.transferKB.html} KB`,
        "HTML decoded": `${m.transferKB.htmlDecoded} KB`,
        "JS transfer": `${m.transferKB.js} KB`,
        "CSS transfer": `${m.transferKB.css} KB`,
        "resource transfer": `${m.transferKB.resources} KB`,
        "total transfer": `${m.transferKB.total} KB`,
        longTasks: `${m.longTasks.count} (${m.longTasks.total.toFixed(0)} ms, max ${m.longTasks.max.toFixed(0)})`,
        LoAF: `${m.loaf.count} (maxBlocking ${m.loaf.maxBlocking.toFixed(0)} ms)`,
      });
      writeReport(`page-prod__${name}`, { path, ...m });

      expect.soft(m.lcp, `${name} LCP`).toBeLessThan(BUDGETS.lcpMs);
      expect.soft(m.fcp, `${name} FCP`).toBeLessThan(BUDGETS.fcpMs);
      expect.soft(m.ttfb, `${name} TTFB`).toBeLessThan(BUDGETS.ttfbMs);
      expect.soft(m.cls, `${name} CLS`).toBeLessThan(BUDGETS.cls);
      expect.soft(m.transferKB.js, `${name} JS transfer`).toBeLessThan(BUDGETS.jsTransferKB);
      expect
        .soft(m.transferKB.total, `${name} total transfer`)
        .toBeLessThan(BUDGETS.totalTransferKB);
    });
  }

  test("settled background metrics — Explore complete index", async ({ page }) => {
    await page.goto(ROUTES.explore, { waitUntil: "load" });
    await expect(page.locator("main")).toHaveAttribute("data-index-state", "ready", {
      timeout: 30_000,
    });
    await page.waitForTimeout(500);

    // Snapshot application work before forced GC so measurement work cannot
    // inflate the long-task and LoAF counters.
    const m = await readPagePerf(page);
    await page.evaluate(() => (window as any).gc?.());
    await page.waitForTimeout(300);
    m.heapMB = await page.evaluate(() =>
      "memory" in performance
        ? +(((performance as any).memory.usedJSHeapSize ?? 0) / 1024 / 1024).toFixed(2)
        : 0,
    );
    logTable("explore settled background index", {
      "elapsed after navigation": `${Math.round(m.elapsed)} ms`,
      "DOM nodes": m.domNodes,
      "JS heap": `${m.heapMB} MB`,
      "HTML transfer": `${m.transferKB.html} KB`,
      "resource transfer": `${m.transferKB.resources} KB`,
      "total transfer": `${m.transferKB.total} KB`,
      longTasks: `${m.longTasks.count} (${m.longTasks.total.toFixed(0)} ms, max ${m.longTasks.max.toFixed(0)})`,
      LoAF: `${m.loaf.count} (${m.loaf.total.toFixed(0)} ms, maxBlocking ${m.loaf.maxBlocking.toFixed(0)} ms)`,
    });
    writeReport("page-prod__explore-settled", { path: ROUTES.explore, ...m });

    expect
      .soft(m.transferKB.total, "settled Explore total transfer")
      .toBeLessThan(BUDGETS.exploreSettledTotalTransferKB);
    if (m.heapMB > 0) {
      expect.soft(m.heapMB, "settled Explore JS heap").toBeLessThan(BUDGETS.exploreSettledHeapMB);
    } else {
      test.info().annotations.push({
        type: "heap",
        description: "Precise heap instrumentation unavailable",
      });
    }
    expect
      .soft(m.domNodes, "settled Explore DOM nodes")
      .toBeLessThan(BUDGETS.exploreSettledDomNodes);
    expect
      .soft(m.longTasks.total, "settled Explore long-task total")
      .toBeLessThan(BUDGETS.exploreSettledLongTaskTotalMs);
    expect(m.loaf.supported, "Chromium must expose LoAF instrumentation").toBe(true);
    expect
      .soft(m.loaf.total, "settled Explore LoAF total")
      .toBeLessThan(BUDGETS.exploreSettledLoafTotalMs);
    expect
      .soft(m.loaf.maxBlocking, "settled Explore LoAF max blocking")
      .toBeLessThan(BUDGETS.exploreSettledLoafMaxBlockingMs);
  });

  test("interaction jank — ticker timeframe switching", async ({ page }) => {
    await page.goto(ROUTES.ticker, { waitUntil: "load" });
    await page.getByRole("tab", { name: "1M", exact: true }).first().waitFor({ timeout: 30000 });
    // reset accumulators so we measure interaction-time jank, not load-time
    await page.evaluate(() => {
      const s = (window as any).__pp;
      s.longTasks = { count: 0, total: 0, max: 0 };
      s.loaf = {
        supported: s.loaf.supported,
        count: 0,
        total: 0,
        maxBlocking: 0,
      };
    });

    await switchTimeframes(page, ["1M", "1D", "1Y", "1W", "3M", "All", "6M", "1M"]);
    const m = await readPagePerf(page);

    logTable("ticker interaction jank", {
      longTasks: `${m.longTasks.count} (${m.longTasks.total.toFixed(0)} ms total, max ${m.longTasks.max.toFixed(0)} ms)`,
      LoAF: `${m.loaf.count} (maxBlocking ${m.loaf.maxBlocking.toFixed(0)} ms)`,
    });
    writeReport("page-prod__interaction-jank", {
      longTasks: m.longTasks,
      loaf: m.loaf,
    });

    expect
      .soft(m.longTasks.total, "interaction long-task total")
      .toBeLessThan(BUDGETS.longTaskTotalMs);
    expect(m.loaf.supported, "Chromium must expose LoAF instrumentation").toBe(true);
    expect
      .soft(m.loaf.maxBlocking, "interaction LoAF max blocking")
      .toBeLessThan(BUDGETS.loafMaxBlockingMs);
  });
});
