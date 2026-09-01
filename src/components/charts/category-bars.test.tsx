import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { PreferencesProvider } from "#/lib/preferences.tsx";
import { CategoryBars } from "./category-bars.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
const globalRecord = globalThis as Record<string, unknown>;
const domGlobals = {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  cancelAnimationFrame: clearTimeout,
};
const originalGlobals = new Map(
  Object.keys(domGlobals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
Object.assign(globalRecord, domGlobals);
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

const { cleanup, render } = await import("@testing-library/react");

afterEach(cleanup);
afterAll(() => {
  for (const key of Object.keys(domGlobals)) {
    const original = originalGlobals.get(key);
    if (original) {
      Object.defineProperty(globalThis, key, original);
    } else {
      delete globalRecord[key];
    }
  }
  dom.window.close();
});

describe("CategoryBars", () => {
  test("keeps every signed percentage glyph hidden before reveal", () => {
    const { container } = render(
      <PreferencesProvider>
        <CategoryBars
          rows={[{ key: "1w", label: "1w", value: 0.005 }]}
          transitionKey="horizon-bars-unrevealed"
        />
      </PreferencesProvider>,
    );

    const visualNumber = container.querySelector('[aria-hidden="true"]');
    expect(visualNumber?.textContent).toBe("+0.5%");

    const glyphs = Array.from(visualNumber?.querySelectorAll(":scope > span > span") ?? []);
    expect(glyphs).toHaveLength(5);
    expect(glyphs.every((glyph) => glyph.getAttribute("style")?.includes("opacity: 0"))).toBeTrue();
  });
});
