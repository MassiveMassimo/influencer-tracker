import { test, expect } from "bun:test";
import { publishedMessage, blockedMessage } from "./notify";

test("publishedMessage states handle + counts, no SSH review command", () => {
  const m = publishedMessage("theprofinvestor", 4, 2);
  expect(m).toContain("theprofinvestor");
  expect(m).toContain("4");
  expect(m).toContain("2");
  expect(m).not.toContain("calls.review.md"); // no human-review prompt anymore
});

test("blockedMessage names the reason and the manual investigation command", () => {
  const m = blockedMessage("theprofinvestor", "guard: scored 1 << baseline 30");
  expect(m).toContain("theprofinvestor");
  expect(m).toContain("guard: scored 1 << baseline 30");
  expect(m).toContain("resume.ts theprofinvestor"); // operator can re-run after investigating
});
