import { expect, test, type Page, type Route } from "@playwright/test";
import { ROUTES } from "./helpers";

function creatorPageFromRoute(route: Route): number | null {
  const serialized = new URL(route.request().url()).searchParams.get("payload");
  if (!serialized) return null;

  const visit = (value: unknown): number | null => {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const properties = record.p as { k?: unknown[]; v?: unknown[] } | undefined;
    const pageIndex = properties?.k?.indexOf("page");
    if (pageIndex != null && pageIndex >= 0) {
      const encoded = properties?.v?.[pageIndex] as { s?: unknown } | undefined;
      return typeof encoded?.s === "number" ? encoded.s : null;
    }
    for (const child of Object.values(record)) {
      const page = visit(child);
      if (page != null) return page;
    }
    return null;
  };

  return visit(JSON.parse(serialized));
}

async function failCallsIndex(page: Page, shouldFail: () => boolean) {
  const handler = async (route: Route) => {
    if (shouldFail()) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      });
    } else {
      await route.continue();
    }
  };
  await page.route("**/api/calls-index", handler);
  await page.route("**/calls-index.json", handler);
}

test.describe("async data correctness", () => {
  test("Explore never presents partial rows as complete filter results", async ({ page }) => {
    let releaseIndex!: () => void;
    const indexGate = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });
    await page.route("**/api/calls-index", async (route) => {
      await indexGate;
      await route.continue();
    });

    await page.goto(ROUTES.explore, { waitUntil: "load" });
    await page.getByRole("searchbox", { name: "Search ticker, company, or creator" }).fill("AAPL");

    await expect(page.getByRole("status")).toHaveText("Loading the complete call index…");
    await expect(page.getByText("No calls match.")).toHaveCount(0);
    await expect(page.getByRole("menu", { name: "Calls" })).toHaveCount(0);

    releaseIndex();

    await expect(page.locator("main")).toHaveAttribute("data-index-state", "ready");
    await expect(page.getByRole("link", { name: "AAPL", exact: true }).first()).toBeVisible();
  });

  test("Explore exposes an error and retries without partial filter results", async ({ page }) => {
    let failIndex = true;
    await failCallsIndex(page, () => failIndex);

    await page.goto(ROUTES.explore, { waitUntil: "load" });
    await page.getByRole("searchbox", { name: "Search ticker, company, or creator" }).fill("AAPL");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("No partial filter results are shown.", {
      timeout: 20_000,
    });
    await expect(page.getByText("No calls match.")).toHaveCount(0);
    await expect(page.getByRole("menu", { name: "Calls" })).toHaveCount(0);

    failIndex = false;
    await alert.getByRole("button", { name: "Retry" }).click();

    await expect(page.locator("main")).toHaveAttribute("data-index-state", "ready");
    await expect(page.getByRole("link", { name: "AAPL", exact: true }).first()).toBeVisible();
  });

  test("creator paging keeps the displayed range accurate and does not cascade prefetches", async ({
    page,
  }) => {
    let releasePageTwo!: () => void;
    const pageTwoGate = new Promise<void>((resolve) => {
      releasePageTwo = resolve;
    });
    const requestedPages: number[] = [];

    await page.route("**/_serverFn/**", async (route) => {
      const requestedPage = creatorPageFromRoute(route);
      if (requestedPage == null) {
        await route.continue();
        return;
      }
      requestedPages.push(requestedPage);
      if (requestedPage === 2) await pageTwoGate;
      await route.continue();
    });

    await page.goto(ROUTES.creator, { waitUntil: "load" });
    await page.getByRole("button", { name: "Go to page 2" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Loading page 2…" })).toHaveText(
      "Loading page 2…",
    );
    await expect(page.getByText("1–25 of 2035")).toBeVisible();

    releasePageTwo();

    await expect(page.getByText("26–50 of 2035")).toBeVisible();
    await page.waitForTimeout(250);
    expect(requestedPages).toEqual([2]);
  });

  test("creator paging keeps the current rows through an error and retry", async ({ page }) => {
    let failPageTwo = true;
    await page.route("**/_serverFn/**", async (route) => {
      if (creatorPageFromRoute(route) !== 2 || !failPageTwo) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      });
    });

    await page.goto(ROUTES.creator, { waitUntil: "load" });
    await page.getByRole("button", { name: "Go to page 2" }).click();

    const retry = page.getByRole("button", {
      name: "Page 2 failed. Retry",
    });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("1–25 of 2035")).toBeVisible();

    failPageTwo = false;
    await retry.click();

    await expect(page.getByText("26–50 of 2035")).toBeVisible();
    await expect(retry).toHaveCount(0);
  });
});
