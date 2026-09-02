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

  test("font delivery stays local and preserves the grade face", async ({ page }) => {
    const externalFontRequests: string[] = [];
    const fontResponses: Array<{ url: string; ok: boolean }> = [];
    page.on("request", (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) {
        externalFontRequests.push(request.url());
      }
    });
    page.on("response", (response) => {
      if (/\.woff2(?:\?|$)/.test(response.url())) {
        fontResponses.push({ url: response.url(), ok: response.ok() });
      }
    });

    await page.goto(ROUTES.home, { waitUntil: "load" });
    const bodyFamily = await page
      .locator("body")
      .evaluate((body) => getComputedStyle(body).fontFamily);
    const monoLoaded = await page.evaluate(
      async () => (await document.fonts.load('16px "Geist Mono Variable"', "A")).length > 0,
    );

    await page.goto(ROUTES.creator, { waitUntil: "load" });
    const grade = page.locator(".display-title").first();
    await expect(grade).toBeVisible();
    const gradeLoaded = await page.evaluate(
      async () => (await document.fonts.load('900 32px "Fraunces Grade"', "A+")).length > 0,
    );
    const gradeFamily = await grade.evaluate((node) => getComputedStyle(node).fontFamily);
    const frauncesResources = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /fraunces-grade-.*\.woff2$/.test(url)),
    );

    expect(bodyFamily).toContain("Geist Mono Variable");
    expect(monoLoaded).toBe(true);
    expect(gradeFamily).toContain("Fraunces Grade");
    expect(gradeLoaded).toBe(true);
    expect(frauncesResources).toHaveLength(1);
    expect(fontResponses.length).toBeGreaterThan(0);
    expect(fontResponses.every((response) => response.ok)).toBe(true);
    expect(
      fontResponses.every(
        (response) => new URL(response.url).origin === new URL(page.url()).origin,
      ),
    ).toBe(true);
    expect(externalFontRequests).toEqual([]);
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

  test("removed statistic prefixes animate out when the value gets shorter", async ({ page }) => {
    await page.goto("/c/thelonginvest", { waitUntil: "load" });
    await expect(page.locator(".sr-only").filter({ hasText: /^2,961$/ })).toHaveCount(1);

    await page.evaluate(() => {
      const samples: Array<{
        character: string;
        blur: number;
        opacity: number;
        position: string;
        translateY: number;
      }> = [];
      const startedAt = performance.now();
      const sample = () => {
        const accessibleValue = Array.from(document.querySelectorAll(".sr-only")).find((element) =>
          /^(2,961|116)$/.test(element.textContent ?? ""),
        );
        const visualValue = accessibleValue?.parentElement?.querySelector('[aria-hidden="true"]');

        for (const slot of visualValue?.children ?? []) {
          if (slot.textContent !== "2" && slot.textContent !== ",") continue;

          const style = getComputedStyle(slot);
          const matrix = new DOMMatrixReadOnly(style.transform);
          samples.push({
            character: slot.textContent,
            blur: Number(style.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0),
            opacity: Number(style.opacity),
            position: style.position,
            translateY: matrix.f,
          });
        }

        if (performance.now() - startedAt < 800) requestAnimationFrame(sample);
      };

      (window as any).__statExitSamples = samples;
      requestAnimationFrame(sample);
    });

    await page.getByRole("link", { name: "@roadto100kportfolio", exact: true }).click();
    await expect(page).toHaveURL(/\/c\/roadto100kportfolio$/);
    await expect(page.locator(".sr-only").filter({ hasText: /^116$/ })).toHaveCount(1);
    await page.waitForTimeout(850);

    const samples = await page.evaluate(
      () =>
        (window as any).__statExitSamples as Array<{
          character: string;
          blur: number;
          opacity: number;
          position: string;
          translateY: number;
        }>,
    );

    for (const character of ["2", ","]) {
      const exitingSamples = samples.filter(
        (sample) => sample.character === character && sample.position === "absolute",
      );
      expect(
        exitingSamples.length,
        `${character} must remain mounted while exiting`,
      ).toBeGreaterThan(0);
      expect(
        exitingSamples.some(
          (sample) =>
            sample.opacity > 0.05 &&
            sample.opacity < 0.95 &&
            sample.blur > 0 &&
            sample.translateY < 0,
        ),
        `${character} must fade, blur, and move upward`,
      ).toBe(true);
    }
  });

  test("statistic values stay left aligned while transition slots pair from the right", async ({
    page,
  }) => {
    await page.goto("/c/kevvonz", { waitUntil: "load" });
    const shortValue = page.locator(".sr-only").filter({ hasText: /^71$/ }).locator("..");
    await expect(shortValue).toHaveCount(1);
    const shortRect = await shortValue
      .locator('[aria-hidden="true"]')
      .evaluate((element) => element.getBoundingClientRect().toJSON());

    await page.evaluate(() => {
      const samples: string[][] = [];
      const startedAt = performance.now();
      const sample = () => {
        const accessibleValue = Array.from(document.querySelectorAll(".sr-only")).find((element) =>
          /^(71|2,159)$/.test(element.textContent ?? ""),
        );
        const visualValue = accessibleValue?.parentElement?.querySelector('[aria-hidden="true"]');
        samples.push(Array.from(visualValue?.children ?? [], (slot) => slot.textContent ?? ""));

        if (performance.now() - startedAt < 800) requestAnimationFrame(sample);
      };

      (window as any).__statSlotSamples = samples;
      requestAnimationFrame(sample);
    });

    await page.getByRole("link", { name: "@TheProfInvestor", exact: true }).click();
    await expect(page).toHaveURL(/\/c\/TheProfInvestor$/);
    const longValue = page
      .locator(".sr-only")
      .filter({ hasText: /^2,159$/ })
      .locator("..");
    await expect(longValue).toHaveCount(1);
    await page.waitForTimeout(850);
    const longRect = await longValue
      .locator('[aria-hidden="true"]')
      .evaluate((element) => element.getBoundingClientRect().toJSON());
    const samples = await page.evaluate(() => (window as any).__statSlotSamples as string[][]);

    expect(longRect.left).toBeCloseTo(shortRect.left, 0);
    expect(
      samples.some((slots) => slots.includes("75") && slots.includes("19")),
      "7 → 5 and 1 → 9 must share right-aligned transition slots",
    ).toBe(true);
  });

  test("creator activity remains complete and keyboard accessible while switching", async ({
    page,
  }) => {
    await page.goto(ROUTES.creator, { waitUntil: "load" });
    const grid = page.getByRole("grid", { name: /Call activity from/ });
    await expect(grid).toBeVisible();

    await page.locator("html").evaluate((root) => {
      root.setAttribute("data-reduce-motion", "true");
    });
    const transitionDelayProbe = grid.getByRole("gridcell").first();
    await transitionDelayProbe.evaluate((cell) => {
      cell.classList.add("call-activity-cell-transition");
    });
    const reducedMotionDelays = await page
      .locator(
        ".call-activity-wave-cell, .call-activity-cell-transition, .call-activity-wave-month",
      )
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).animationDelay),
      );
    expect(new Set(reducedMotionDelays)).toEqual(new Set(["0s"]));
    await transitionDelayProbe.evaluate((cell) => {
      cell.classList.remove("call-activity-cell-transition");
    });
    await page.locator("html").evaluate((root) => {
      root.removeAttribute("data-reduce-motion");
    });

    const firstCell = grid.locator('[role="gridcell"][tabindex="0"]');
    await firstCell.focus();
    const firstColumn = Number(await firstCell.getAttribute("aria-colindex"));
    const firstRow = await firstCell.getAttribute("aria-rowindex");
    await page.keyboard.press("ArrowRight");
    const nextCell = grid.locator(
      `[role="gridcell"][aria-colindex="${firstColumn + 1}"][aria-rowindex="${firstRow}"]`,
    );
    await expect(nextCell).toBeFocused();
    const activityTooltip = page.locator('[data-slot="call-activity-tooltip"]');
    await expect(activityTooltip).toHaveAttribute("data-state", "open");
    await expect(activityTooltip.locator('[data-slot="call-activity-tooltip-panel"]')).toHaveClass(
      /bg-popover\/90.*shadow-lg.*backdrop-blur-md/,
    );
    expect(await activityTooltip.locator("number-flow-react").count()).toBeGreaterThanOrEqual(2);
    const activityMonth = activityTooltip.locator('[data-slot="call-activity-tooltip-month"]');
    await expect(activityMonth).toHaveCount(1);
    expect(await activityMonth.evaluate((month) => month.scrollWidth <= month.clientWidth)).toBe(
      true,
    );

    const numberedCell = grid
      .getByRole("gridcell", {
        name: / · [1-9]\d* calls?$/,
      })
      .first();
    await numberedCell.hover();
    await expect(activityTooltip.locator("number-flow-react")).toHaveCount(3);

    const countLabel = activityTooltip.locator('[data-slot="call-activity-tooltip-label"]');
    const countLabelOffset = async () =>
      activityTooltip.evaluate((tooltip) => {
        const panel = tooltip.querySelector(
          '[data-slot="call-activity-tooltip-panel"]',
        ) as HTMLElement;
        const label = tooltip.querySelector(
          '[data-slot="call-activity-tooltip-label"]',
        ) as HTMLElement;
        return label.getBoundingClientRect().left - panel.getBoundingClientRect().left;
      });
    await expect(countLabel).toBeVisible();
    const oneDigitCell = grid.getByRole("gridcell", { name: / · [1-9] calls?$/ }).first();
    const multiDigitCell = grid.getByRole("gridcell", { name: / · [1-9]\d+ calls$/ }).first();
    await oneDigitCell.hover();
    await page.waitForTimeout(200);
    const oneDigitOffset = await countLabelOffset();
    await multiDigitCell.hover();
    const movingOffsets: number[] = [];
    for (let frame = 0; frame < 5; frame += 1) {
      await page.waitForTimeout(20);
      movingOffsets.push(await countLabelOffset());
    }
    await page.waitForTimeout(100);
    const multiDigitOffset = await countLabelOffset();
    expect(multiDigitOffset).toBeGreaterThan(oneDigitOffset + 1);
    expect(
      movingOffsets.some(
        (offset) => offset > oneDigitOffset + 0.25 && offset < multiDigitOffset - 0.25,
      ),
    ).toBe(true);
    const readTooltipSpacing = () =>
      activityTooltip.evaluate((tooltip) => {
        const panel = tooltip.querySelector(
          '[data-slot="call-activity-tooltip-panel"]',
        ) as HTMLElement;
        const date = panel.firstElementChild?.firstElementChild as HTMLElement;
        const count = tooltip.querySelector(
          '[data-slot="call-activity-tooltip-count"]',
        ) as HTMLElement;
        const value = tooltip.querySelector(
          '[data-slot="call-activity-tooltip-value"]',
        ) as HTMLElement;
        const label = tooltip.querySelector(
          '[data-slot="call-activity-tooltip-label"]',
        ) as HTMLElement;
        const panelRect = panel.getBoundingClientRect();
        const dateRect = date.getBoundingClientRect();
        const countRect = count.getBoundingClientRect();
        const valueRect = value.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        return {
          horizontalGap: labelRect.left - valueRect.right,
          leftEdgeDelta: Math.abs(dateRect.left - countRect.left),
          verticalGap: countRect.top - dateRect.bottom,
          panelInset: dateRect.left - panelRect.left,
        };
      });
    await expect
      .poll(async () => {
        const spacing = await readTooltipSpacing();
        return (
          spacing.horizontalGap >= 6 &&
          spacing.leftEdgeDelta < 0.5 &&
          spacing.verticalGap >= 3.5 &&
          Math.abs(spacing.panelInset - 12) < 0.5
        );
      })
      .toBe(true);
    const tooltipSpacing = await readTooltipSpacing();
    expect(tooltipSpacing.horizontalGap).toBeGreaterThanOrEqual(6);
    expect(tooltipSpacing.leftEdgeDelta).toBeLessThan(0.5);
    expect(tooltipSpacing.verticalGap).toBeGreaterThanOrEqual(3.5);
    expect(tooltipSpacing.panelInset).toBeCloseTo(12, 0);

    const topCell = grid.locator('[aria-colindex="52"][aria-rowindex="1"]');
    const bottomCell = grid.locator('[aria-colindex="52"][aria-rowindex="7"]');
    await topCell.hover();
    await expect(activityTooltip).toHaveAttribute("data-side", "bottom");
    await bottomCell.hover();
    await expect(activityTooltip).toHaveAttribute("data-side", "top");

    await activityTooltip.evaluate((tooltip) => {
      const audit = {
        closedTransitions: 0,
        node: tooltip,
        observer: new MutationObserver(() => {
          if (tooltip.getAttribute("data-state") === "closed") audit.closedTransitions += 1;
        }),
      };
      audit.observer.observe(tooltip, { attributeFilter: ["data-state"] });
      (window as any).__activityTooltipAudit = audit;
    });

    const hoverTargets = [360, 361, 362, 363, 364].map((index) =>
      grid.getByRole("gridcell").nth(index),
    );
    for (const target of hoverTargets) await target.hover();
    const finalHoverLabel = await hoverTargets.at(-1)!.getAttribute("aria-label");
    await expect(activityTooltip).toHaveAttribute("aria-label", finalHoverLabel!);
    const tooltipAudit = await page.evaluate(() => {
      const audit = (window as any).__activityTooltipAudit;
      audit.observer.disconnect();
      return {
        closedTransitions: audit.closedTransitions,
        sameNode: audit.node === document.querySelector('[data-slot="call-activity-tooltip"]'),
      };
    });
    expect(tooltipAudit.sameNode).toBe(true);
    expect(tooltipAudit.closedTransitions).toBe(0);

    const oldLevels = await grid
      .getByRole("gridcell")
      .evaluateAll((cells) =>
        Object.fromEntries(
          cells.map((cell) => [
            `${(cell as HTMLElement).dataset.activityWeek}:${(cell as HTMLElement).dataset.activityDay}`,
            cell.className.match(/bg-foreground\/\[(0\.\d+)\]/)?.[1] ?? null,
          ]),
        ),
      );

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

    for (const [index, creator] of ["@thelonginvest", "@TheProfInvestor", "@kevvonz"].entries()) {
      await page.getByRole("link", { name: creator, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/c/${creator.slice(1)}$`, "i"));
      if (index === 0) {
        const transitioningCell = page.locator(".call-activity-cell-transition").first();
        await expect(transitioningCell).toBeAttached();
        const transitionSource = await transitioningCell.evaluate((cell) => ({
          position: `${(cell as HTMLElement).dataset.activityWeek}:${(cell as HTMLElement).dataset.activityDay}`,
          color: (cell as HTMLElement).style.getPropertyValue("--call-activity-from-color"),
        }));
        const oldOpacity = oldLevels[transitionSource.position];
        expect(oldOpacity).toBeDefined();
        expect(oldOpacity).not.toBeNull();
        expect(transitionSource.color).toContain(`${Number(oldOpacity) * 100}%`);
      }
      await expect(page.locator(".call-activity-cell-transition")).toHaveCount(0, {
        timeout: 5_000,
      });
      await expect(page.getByRole("gridcell")).toHaveCount(365);
    }

    const m = await readPagePerf(page);
    expect
      .soft(m.longTasks.total, "creator-switch long-task total")
      .toBeLessThan(BUDGETS.longTaskTotalMs);
    expect(m.loaf.supported, "Chromium must expose LoAF instrumentation").toBe(true);
    expect
      .soft(m.loaf.maxBlocking, "creator-switch LoAF max blocking")
      .toBeLessThan(BUDGETS.loafMaxBlockingMs);
  });

  test("creator activity keeps the newest days visible in a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ROUTES.creator, { waitUntil: "load" });

    const region = page.getByRole("region", {
      name: "Call activity calendar. Scroll horizontally to see earlier dates.",
    });
    const viewport = region.locator('[data-slot="scroll-area-viewport"]');
    const grid = page.getByRole("grid", { name: /Call activity from/ });
    await expect(grid).toBeVisible();

    await expect
      .poll(() =>
        viewport.evaluate(
          (element) =>
            element.scrollWidth > element.clientWidth &&
            Math.abs(element.scrollLeft - (element.scrollWidth - element.clientWidth)) <= 1,
        ),
      )
      .toBe(true);

    const newestCell = grid.locator('[aria-colindex="53"]').last();
    await expect(newestCell).toBeVisible();
    const layout = await newestCell.evaluate((cell) => {
      const element = cell.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
      const newest = cell.getBoundingClientRect();
      const viewportRect = element.getBoundingClientRect();
      return {
        newestInsideRightEdge: newest.right <= viewportRect.right + 0.5,
        paddingBottom: getComputedStyle(element).paddingBottom,
      };
    });
    expect(layout.newestInsideRightEdge).toBe(true);
    expect(layout.paddingBottom).toBe("20px");
  });

  test("creator activity does not overflow when the full calendar fits", async ({ page }) => {
    await page.setViewportSize({ width: 1311, height: 948 });
    await page.goto(ROUTES.creator, { waitUntil: "load" });

    const region = page.getByRole("region", {
      name: "Call activity calendar. Scroll horizontally to see earlier dates.",
    });
    const viewport = region.locator('[data-slot="scroll-area-viewport"]');
    await expect(page.getByRole("grid", { name: /Call activity from/ })).toBeVisible();

    await expect
      .poll(() => viewport.evaluate((element) => element.scrollWidth === element.clientWidth))
      .toBe(true);

    await region.hover();
    await expect(region.locator('[data-slot="scroll-area-scrollbar"]')).toHaveCount(0);
  });
});
