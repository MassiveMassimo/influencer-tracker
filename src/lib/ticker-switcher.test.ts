import { test, expect } from "bun:test";
import { pickAvatarTabs, type SwitcherCreator } from "./ticker-switcher";

function c(handle: string, lastCallDate: string): SwitcherCreator {
  return { handle, name: handle, avatar: null, lastCallDate, callCount: 1 };
}
const CREATORS: SwitcherCreator[] = [
  c("alice", "2026-01-01"),
  c("bob", "2026-06-01"),
  c("carol", "2026-03-01"),
  c("dave", "2026-05-01"),
];

test("no selection: 3 most-recent by lastCallDate desc", () => {
  expect(pickAvatarTabs(CREATORS, null).map((x) => x.handle)).toEqual(["bob", "dave", "carol"]);
});

test("roster is stable; selecting a recent creator does not reorder tabs", () => {
  // bob/dave/carol are the top-3; selecting any of them keeps the same order.
  expect(pickAvatarTabs(CREATORS, "carol").map((x) => x.handle)).toEqual(["bob", "dave", "carol"]);
  expect(pickAvatarTabs(CREATORS, "dave").map((x) => x.handle)).toEqual(["bob", "dave", "carol"]);
});

test("selected caller outside top-max is surfaced in the last slot", () => {
  // alice is least-recent (not in top-3); she takes the last slot, recent tabs hold.
  expect(pickAvatarTabs(CREATORS, "alice").map((x) => x.handle)).toEqual(["bob", "dave", "alice"]);
});

test("selected already-recent is not duplicated", () => {
  expect(pickAvatarTabs(CREATORS, "bob").map((x) => x.handle)).toEqual(["bob", "dave", "carol"]);
});

test("selected handle absent from list is ignored", () => {
  expect(pickAvatarTabs(CREATORS, "zzz").map((x) => x.handle)).toEqual(["bob", "dave", "carol"]);
});

test("null lastCallDate sorts last", () => {
  const list = [c("a", "2026-01-01"), { ...c("b", ""), lastCallDate: null }];
  expect(pickAvatarTabs(list, null).map((x) => x.handle)).toEqual(["a", "b"]);
});
