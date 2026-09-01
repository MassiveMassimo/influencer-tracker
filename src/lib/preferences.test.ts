import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";

// bun test has no DOM by default; register a jsdom env for this file.
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "http://localhost/",
});
const g = globalThis as Record<string, unknown>;
const globalKeys = ["window", "document", "localStorage"] as const;
const originalGlobals = new Map(
  globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
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

afterAll(() => {
  for (const key of globalKeys) {
    const original = originalGlobals.get(key);
    if (original) {
      Object.defineProperty(globalThis, key, original);
    } else {
      delete g[key];
    }
  }
  dom.window.close();
});

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-reduce-motion");
  localStorage.clear();
});

describe("readStoredPrefs", () => {
  it("defaults when nothing stored", () => {
    expect(readStoredPrefs()).toEqual({
      theme: "auto",
      reduceMotion: false,
      reduceHaptics: false,
      interfaceSounds: true,
      showHalalStatus: false,
      badgeStyle: "enamel",
    });
  });

  it("reads persisted values", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("reduce-motion", "true");
    localStorage.setItem("reduce-haptics", "true");
    localStorage.setItem("interface-sounds", "false");
    localStorage.setItem("show-halal", "true");
    localStorage.setItem("badge-style", "candy");
    expect(readStoredPrefs()).toEqual({
      theme: "dark",
      reduceMotion: true,
      reduceHaptics: true,
      interfaceSounds: false,
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
