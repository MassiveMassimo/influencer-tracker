import { test, expect } from "@playwright/test";
import { BUDGETS, ROUTES, logTable, switchTimeframes, writeReport } from "./helpers";

// Heap-growth leak check: baseline → many timeframe switches → forced GC →
// re-measure. A flat-ish heap means listeners/timers/charts unmount cleanly;
// steady growth across identical interactions points at a leak (uncleared
// observers, retained chart instances, detached nodes).
// Requires --js-flags=--expose-gc + --enable-precise-memory-info (set per the
// page-prod project in playwright.config.ts).
test("ticker heap growth over repeated timeframe switches", async ({ page }) => {
  const heap = () => page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0);
  const gc = async () => {
    await page.evaluate(() => (window as any).gc?.());
    await page.waitForTimeout(300);
  };

  await page.goto(ROUTES.ticker, { waitUntil: "load" });
  await page.getByRole("tab", { name: "1M", exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);

  await gc();
  const before = await heap();
  test.skip(before === 0, "precise heap unavailable (launch flags not applied)");

  const CYCLES = 4;
  const SEQ = ["1D", "1W", "1M", "3M", "6M", "1Y", "All"];
  for (let c = 0; c < CYCLES; c++) await switchTimeframes(page, SEQ, 250);

  await gc();
  const after = await heap();
  const growthMB = +((after - before) / 1024 / 1024).toFixed(2);

  logTable("ticker heap growth", {
    interactions: CYCLES * SEQ.length,
    "heap before": `${(before / 1024 / 1024).toFixed(1)} MB`,
    "heap after GC": `${(after / 1024 / 1024).toFixed(1)} MB`,
    growth: `${growthMB} MB`,
  });
  writeReport("page-prod__memory", { before, after, growthMB, interactions: CYCLES * SEQ.length });

  expect
    .soft(growthMB, "heap growth over repeated identical interactions")
    .toBeLessThan(BUDGETS.heapGrowthMB);
});
