import { describe, expect, it } from "bun:test";
import { parseChangelog } from "./changelog";

describe("parseChangelog", () => {
  it("groups items by date and tag, ignoring the H1/intro and joining wrapped bullets", () => {
    const md = [
      "# Changelog",
      "",
      "Intro paragraph with a [link](https://x).",
      "",
      "## 2026-06-22",
      "",
      "### Added",
      "- First item that wraps",
      "  onto a second line.",
      "- Second item.",
      "",
      "### Fixed",
      "- A fix.",
      "",
      "## 2026-06-19",
      "",
      "### Added",
      "- Older item.",
    ].join("\n");

    const out = parseChangelog(md);

    expect(out.map((e) => e.date)).toEqual(["2026-06-22", "2026-06-19"]);
    expect(out[0].groups.map((g) => g.tag)).toEqual(["Added", "Fixed"]);
    expect(out[0].groups[0].items).toEqual([
      "First item that wraps onto a second line.",
      "Second item.",
    ]);
    expect(out[1].groups[0].items).toEqual(["Older item."]);
  });
});
