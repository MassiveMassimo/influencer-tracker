import { expect, test, type Page, type Route } from "@playwright/test";
import { ROUTES } from "./helpers";

const CREATOR_HANDLE = ROUTES.creator.split("/").at(-1);

function creatorPageFromRoute(route: Route): number | null {
  const serialized = new URL(route.request().url()).searchParams.get("payload");
  if (!serialized) return null;

  const visit = (value: unknown): number | null => {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const properties = record.p as { k?: unknown[]; v?: unknown[] } | undefined;
    const pageIndex = properties?.k?.indexOf("page");
    const handleIndex = properties?.k?.indexOf("handle");
    if (pageIndex != null && pageIndex >= 0 && handleIndex != null && handleIndex >= 0) {
      const encodedPage = properties?.v?.[pageIndex] as { s?: unknown } | undefined;
      const encodedHandle = properties?.v?.[handleIndex] as { s?: unknown } | undefined;
      return encodedHandle?.s === CREATOR_HANDLE && typeof encodedPage?.s === "number"
        ? encodedPage.s
        : null;
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

async function creatorCallTotal(page: Page) {
  const initialRange = page.locator("#calls").getByText(/^1–25 of \d+$/);
  await expect(initialRange).toBeVisible();
  const match = (await initialRange.textContent())?.match(/^1–25 of (\d+)$/);
  if (!match) throw new Error("Creator call range did not expose its total");
  return match[1];
}

test.describe("async data correctness", () => {
  test("Explore defers the complete index after in-app navigation", async ({ page }) => {
    const callsIndexRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/calls-index" || pathname === "/calls-index.json") {
        callsIndexRequests.push(pathname);
      }
    });

    await page.goto(ROUTES.home, { waitUntil: "load" });
    await page.locator('a[href="/explore"]').first().click();
    await page.waitForURL("**/explore");

    expect(callsIndexRequests).toEqual([]);

    await page.getByRole("searchbox", { name: "Search ticker, company, or creator" }).focus();
    await expect.poll(() => callsIndexRequests).toEqual(["/api/calls-index"]);
    await expect(page.locator("main")).toHaveAttribute("data-index-state", "ready");
  });

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
    await expect(page.getByRole("navigation", { name: "Calls" })).toHaveCount(0);

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
    await expect(page.getByRole("navigation", { name: "Calls" })).toHaveCount(0);

    failIndex = false;
    await alert.getByRole("button", { name: "Retry" }).click();

    await expect(page.locator("main")).toHaveAttribute("data-index-state", "ready");
    await expect(page.getByRole("link", { name: "AAPL", exact: true }).first()).toBeVisible();
  });

  test("Explore exposes an error and retries while expanding the default view", async ({
    page,
  }) => {
    let failIndex = true;
    await failCallsIndex(page, () => failIndex);

    await page.goto(ROUTES.explore, { waitUntil: "load" });
    const showMore = page.getByRole("button", { name: /Show 50 more/ });
    await showMore.hover();
    await showMore.click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The complete call index did not load.", {
      timeout: 20_000,
    });

    failIndex = false;
    await alert.getByRole("button", { name: "Retry" }).click();

    await expect(page.locator("main")).toHaveAttribute("data-index-state", "ready");
    await expect(alert).toHaveCount(0);
  });

  test("creator page artifacts contain one bounded page", async ({ request }) => {
    const response = await request.get("/dataset-pages/TheProfInvestor/2.json");

    expect(response.ok()).toBe(true);
    const page = await response.json();
    expect(page.currentPage).toBe(2);
    expect(page.calls).toHaveLength(25);
    expect((await response.body()).byteLength).toBeLessThan(100_000);
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
    const total = await creatorCallTotal(page);
    const pageTwoButton = page.getByRole("button", { name: "Go to page 2" });
    await pageTwoButton.hover();
    await expect.poll(() => requestedPages).toEqual([2]);
    await pageTwoButton.click();

    await expect(page.getByRole("status").filter({ hasText: "Loading page 2…" })).toHaveText(
      "Loading page 2…",
    );
    await expect(page.getByText(`1–25 of ${total}`, { exact: true })).toBeVisible();
    await expect(page.locator('#calls nav[aria-label="Calls"] [role="button"]')).toHaveCount(25);

    releasePageTwo();

    await expect(page.getByText(`26–50 of ${total}`, { exact: true })).toBeVisible();
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
    const total = await creatorCallTotal(page);
    await page.getByRole("button", { name: "Go to page 2" }).click();

    const retry = page.getByRole("button", {
      name: "Page 2 failed. Retry",
    });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`1–25 of ${total}`, { exact: true })).toBeVisible();
    await expect(page.locator('#calls nav[aria-label="Calls"] [role="button"]')).toHaveCount(25);

    failPageTwo = false;
    await retry.click();

    await expect(page.getByText(`26–50 of ${total}`, { exact: true })).toBeVisible();
    await expect(retry).toHaveCount(0);
  });
});
