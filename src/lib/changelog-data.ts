import { parseChangelog } from "./changelog";
// CHANGELOG.md (repo root) inlined at build via Vite's ?raw. Kept out of the route
// file because the TanStack route-splitter can't resolve a relative ?raw import from
// its virtual split module — a plain lib module resolves it normally.
import changelogRaw from "../../CHANGELOG.md?raw";

export const CHANGELOG_ENTRIES = parseChangelog(changelogRaw);
