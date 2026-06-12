import { test, expect } from "bun:test";
import { revalidatePaths } from "./revalidate-creator";

test("builds deduped path set for a creator + its tickers", () => {
  const paths = revalidatePaths("TheProfInvestor", ["AAPL", "MSFT", "AAPL"]);
  expect(paths).toContain("/c/TheProfInvestor");
  expect(paths).toContain("/api/dataset/TheProfInvestor");
  expect(paths).toContain("/explore");
  expect(paths).toContain("/api/calls-index");
  expect(paths).toContain("/t/AAPL");
  expect(paths).toContain("/api/prices/MSFT");
  // AAPL appears once each as /t/ and /api/prices/, not twice
  expect(paths.filter((p) => p === "/t/AAPL")).toHaveLength(1);
});
