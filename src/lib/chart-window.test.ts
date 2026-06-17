import { describe, it, expect } from "bun:test";
import { chartWindow } from "./chart-window.ts";

const NOW = new Date("2026-06-03T12:00:00Z"); // a Wednesday
const SATURDAY = new Date("2026-06-06T12:00:00Z");
const FIRST = new Date("2025-06-03T00:00:00Z"); // ~1y of history

describe("chartWindow", () => {
  it("uses 5m for 1D over a window wide enough to always contain the last session", () => {
    const w = chartWindow("1D", { now: NOW, firstDate: FIRST });
    expect(w.interval).toBe("5m");
    // 5 days back clears weekends/holidays so the live fetch never returns an
    // empty pre-open window; trimToLastSession then narrows it to one session.
    expect(w.period1.toISOString().slice(0, 10)).toBe("2026-05-29");
  });

  it("1D on a weekend still spans back past the weekend", () => {
    const w = chartWindow("1D", { now: SATURDAY, firstDate: FIRST });
    expect(w.interval).toBe("5m");
    expect(w.period1.toISOString().slice(0, 10)).toBe("2026-06-01"); // 5d before Sat
  });

  it("uses 30m for 1W (7 days back)", () => {
    const w = chartWindow("1W", { now: NOW, firstDate: FIRST });
    expect(w.interval).toBe("30m");
    expect(w.period1.toISOString().slice(0, 10)).toBe("2026-05-27");
  });

  it("uses 1h for 1M (30 days back)", () => {
    const w = chartWindow("1M", { now: NOW, firstDate: FIRST });
    expect(w.interval).toBe("1h");
    expect(w.period1.toISOString().slice(0, 10)).toBe("2026-05-04");
  });

  it("uses daily for 3M/6M/1Y", () => {
    for (const tf of ["3M", "6M", "1Y"] as const) {
      expect(chartWindow(tf, { now: NOW, firstDate: FIRST }).interval).toBe("1d");
    }
  });

  it("intraday intervals only appear for windows that fit Yahoo's 60-day cap", () => {
    const intraday = new Set(["5m", "30m", "1h"]);
    for (const tf of ["1D", "1W", "1M"] as const) {
      expect(intraday.has(chartWindow(tf, { now: NOW, firstDate: FIRST }).interval)).toBe(true);
    }
    for (const tf of ["3M", "6M", "1Y", "All"] as const) {
      expect(intraday.has(chartWindow(tf, { now: NOW, firstDate: FIRST }).interval)).toBe(false);
    }
  });

  it("All starts at firstDate; uses 1d under 2y, 1wk beyond", () => {
    const recent = chartWindow("All", { now: NOW, firstDate: FIRST });
    expect(recent.interval).toBe("1d");
    expect(recent.period1.toISOString().slice(0, 10)).toBe("2025-06-03");

    const old = chartWindow("All", { now: NOW, firstDate: new Date("2022-01-01T00:00:00Z") });
    expect(old.interval).toBe("1wk");
    expect(old.period1.toISOString().slice(0, 10)).toBe("2022-01-01");
  });
});
