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

test("selected creator is pinned first, rest fill by recency", () => {
  expect(pickAvatarTabs(CREATORS, "alice").map((x) => x.handle)).toEqual(["alice", "bob", "dave"]);
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
