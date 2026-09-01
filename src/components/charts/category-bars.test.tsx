import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesProvider } from "#/lib/preferences.tsx";
import { CategoryBars } from "./category-bars.tsx";

describe("CategoryBars", () => {
  test("renders values through the shared animated number component", () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <CategoryBars
          rows={[{ key: "1w", label: "1w", value: 0.005 }]}
          transitionKey="horizon-bars"
        />
      </PreferencesProvider>,
    );

    expect(html).toContain('class="relative inline-flex whitespace-nowrap"');
    expect(html).toContain(">+0.5%<");
    expect(html).not.toContain("number-flow-react");
  });
});
