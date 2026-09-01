import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCallActivityCalendar } from "#/lib/call-activity";
import { advanceActivityTransition, callActivityWaveDelay, CallActivity } from "./call-activity";

describe("CallActivity", () => {
  test("keeps the previous creator calendar as the color-transition source", () => {
    const first = buildCallActivityCalendar([{ date: "2026-08-25", count: 5 }], "2026-08-25");
    const second = buildCallActivityCalendar([{ date: "2026-08-25", count: 1 }], "2026-08-25");

    const initial = advanceActivityTransition(null, "first", first);
    const next = advanceActivityTransition(initial, "second", second);

    expect(next.current).toBe(second);
    expect(next.outgoing).toBe(first);
    expect(next.mode).toBe("switching");
  });

  test("eases the wave travel while preserving its left-to-right order", () => {
    const delays = Array.from({ length: 53 }, (_, index) => callActivityWaveDelay(index, 53));

    expect(delays[0]).toBe(0);
    expect(delays.at(-1)).toBe(780);
    expect(delays.every((delay, index) => index === 0 || delay > delays[index - 1]!)).toBe(true);
    expect(delays[13]).toBeLessThan(195);
    expect(delays[39]).toBeLessThan(585);
  });

  test("renders the range, summary, bespoke tooltip layer, and wave hooks", () => {
    const html = renderToStaticMarkup(
      <CallActivity
        creatorHandle="test-creator"
        activity={[
          { date: "2026-08-23", count: 2 },
          { date: "2026-08-25", count: 5 },
        ]}
        generatedAt="2026-08-25T00:00:00Z"
      />,
    );

    expect(html).toContain("Call activity");
    expect(html).toContain("Aug 26, 2025–Aug 25, 2026");
    expect(html).toContain("2 active days");
    expect(html).toContain("Busiest day: Aug 25 with 5 calls");
    expect(html).toContain('aria-label="Aug 25, 2026 · 5 calls"');
    expect(html).toContain("call-activity-wave-cell");
    expect(html).toContain("call-activity-wave-month");
    expect(html.match(/data-slot="call-activity-tooltip"/g)).toHaveLength(1);
    expect(html).toContain('role="tooltip"');
    expect(html).not.toContain("data-base-ui-tooltip-trigger");
    const firstDelay = html.match(
      /aria-label="Aug 26, 2025 · No calls"[^>]+--call-activity-wave-delay:(\d+)ms/,
    )?.[1];
    const lastDelay = html.match(
      /aria-label="Aug 25, 2026 · 5 calls"[^>]+--call-activity-wave-delay:(\d+)ms/,
    )?.[1];
    expect(Number(firstDelay)).toBeLessThan(Number(lastDelay));
    expect(html).not.toContain("Calls per day");
  });

  test("exposes one keyboard entry point for the day grid", () => {
    const html = renderToStaticMarkup(
      <CallActivity
        creatorHandle="test-creator"
        activity={[{ date: "2026-08-25", count: 5 }]}
        generatedAt="2026-08-25T00:00:00Z"
      />,
    );

    expect(html).toContain('role="grid"');
    expect(html).toContain('role="gridcell"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Aug 25, 2026 · 5 calls"');
    expect(html).not.toContain("data-count=");
    expect(html).not.toContain("data-wave-delay=");
  });

  test("renders a clear empty state without an empty grid", () => {
    const html = renderToStaticMarkup(
      <CallActivity
        creatorHandle="test-creator"
        activity={[]}
        generatedAt="2026-08-25T00:00:00Z"
      />,
    );

    expect(html).toContain("No call activity yet.");
    expect(html).not.toContain('data-slot="call-activity-grid"');
  });
});
