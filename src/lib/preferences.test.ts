import { describe, expect, it, beforeEach } from "bun:test";
import { JSDOM } from "jsdom";

// bun test has no DOM by default; register a jsdom env for this file.
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "http://localhost/",
});
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.localStorage = dom.window.localStorage;
// jsdom does not implement matchMedia; stub a non-dark default.
dom.window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() {
    return false;
  },
})) as typeof dom.window.matchMedia;

import { applyTheme, readStoredPrefs } from "./preferences.tsx";

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-reduce-motion");
  localStorage.clear();
  document.cookie = "badge-style=; path=/; max-age=0";
  document.cookie = "show-halal=; path=/; max-age=0";
});

describe("readStoredPrefs", () => {
  it("defaults when nothing stored", () => {
    expect(readStoredPrefs()).toEqual({
      theme: "auto",
      reduceMotion: false,
      reduceHaptics: false,
      showHalalStatus: false,
      badgeStyle: "enamel",
    });
  });

  it("reads persisted values", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("reduce-motion", "true");
    localStorage.setItem("reduce-haptics", "true");
    document.cookie = "show-halal=true; path=/";
    document.cookie = "badge-style=candy; path=/";
    expect(readStoredPrefs()).toEqual({
      theme: "dark",
      reduceMotion: true,
      reduceHaptics: true,
      showHalalStatus: true,
      badgeStyle: "candy",
    });
  });
});

describe("applyTheme", () => {
  it("sets explicit theme class + data-theme", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("auto removes data-theme", () => {
    applyTheme("auto");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});
