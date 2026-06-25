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

test("blockedMessage: default keeps the X resume command; override replaces it", () => {
  expect(blockedMessage("foo", "why")).toContain("scripts/resume.ts foo");
  const ig = blockedMessage("bar", "session died", "RE-AUTH VIA VNC then re-run");
  expect(ig).toContain("RE-AUTH VIA VNC then re-run");
  expect(ig).not.toContain("scripts/resume.ts");
});
