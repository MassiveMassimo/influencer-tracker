// Parse the repo CHANGELOG.md (Keep a Changelog format, date-grouped) into a
// structured timeline. Pure + string-only so it stays React-free and unit-testable;
// the /changelog route imports CHANGELOG.md raw and renders the result.

export interface ChangelogGroup {
  tag: string; // "Added" | "Changed" | … ("" when items appear with no ### heading)
  items: string[]; // raw inline markdown, rendered by the route
}

export interface ChangelogEntry {
  date: string; // the "## " heading text (an ISO date, or e.g. "Unreleased")
  groups: ChangelogGroup[];
}

export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let group: ChangelogGroup | null = null;

  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) {
      entry = { date: line.slice(3).trim(), groups: [] };
      entries.push(entry);
      group = null;
    } else if (line.startsWith("### ")) {
      if (!entry) continue;
      group = { tag: line.slice(4).trim(), items: [] };
      entry.groups.push(group);
    } else if (line.startsWith("- ")) {
      if (!entry) continue;
      if (!group) {
        group = { tag: "", items: [] };
        entry.groups.push(group);
      }
      group.items.push(line.slice(2).trim());
    } else if (/^\s+\S/.test(line) && group && group.items.length > 0) {
      // Continuation of a wrapped bullet — join onto the previous item.
      group.items[group.items.length - 1] += " " + line.trim();
    }
    // Anything else (the H1 + intro before the first "## ", blank lines) is ignored.
  }
  return entries;
}
