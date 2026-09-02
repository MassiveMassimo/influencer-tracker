import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { PreferencesProvider } from "#/lib/preferences.tsx";

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
  customElements: dom.window.customElements,
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

mock.module("@scritto/react", () => ({
  default: ({ value }: { value: string | number }) => (
    <scritto-text aria-label={String(value)} role="img">
      {value}
    </scritto-text>
  ),
}));

const { cleanup, render } = await import("@testing-library/react");
const { CategoryBars } = await import("./category-bars.tsx");

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
  test("renders each formatted value through Scritto", () => {
    const { container } = render(
      <PreferencesProvider>
        <CategoryBars rows={[{ key: "1w", label: "1w", value: 0.005 }]} />
      </PreferencesProvider>,
    );

    const value = container.querySelector("scritto-text");
    expect(value?.getAttribute("role")).toBe("img");
    expect(value?.getAttribute("aria-label")).toBe("+0.5%");
  });
});
