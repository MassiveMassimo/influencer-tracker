import { test, expect } from "bun:test";
import { reviewMessage } from "./notify";
test("review ping carries handle, counts, and the flock'd resume", () => {
  const m = reviewMessage("TheProfInvestor", 3, 2);
  expect(m).toContain("TheProfInvestor");
  expect(m).toContain("3 new");
  expect(m).toContain("flock");
  expect(m).toContain("resume.ts");
});
