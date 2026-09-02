import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesProvider } from "#/lib/preferences.tsx";
import { ScrittoNumber, ScrittoText } from "./scritto-number.tsx";

describe("ScrittoNumber", () => {
  test("formats the value before passing accessible SSR text to Scritto", () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <ScrittoNumber
          format={{
            style: "percent",
            signDisplay: "exceptZero",
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }}
          value={0.052}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain("<scritto-text");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="+5.2%"');
    expect(html).toContain(">+5.2%</scritto-text>");
  });

  test("renders changing identity text through the same accessible Scritto host", () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <ScrittoText className="inline-block" value="The Prof Investor" />
      </PreferencesProvider>,
    );

    expect(html).toContain('<scritto-text role="img" aria-label="The Prof Investor"');
    expect(html).toContain('class="inline-block"');
    expect(html).toContain(">The Prof Investor</scritto-text>");
  });
});
