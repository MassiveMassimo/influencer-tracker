export interface SwitcherCreator {
  handle: string;
  name: string;
  avatar: string | null;
  lastCallDate: string | null;
  callCount: number;
}

// Most-recent first by lastCallDate (nulls last), ties by handle asc.
function byRecency(a: SwitcherCreator, b: SwitcherCreator): number {
  const ad = a.lastCallDate ?? "";
  const bd = b.lastCallDate ?? "";
  if (ad !== bd) return bd.localeCompare(ad);
  return a.handle.localeCompare(b.handle);
}

// Avatar tabs for the switcher: selected creator pinned first (when it is a
// caller), then the most-recent other callers, capped at `max` total.
export function pickAvatarTabs(
  creators: SwitcherCreator[],
  selected: string | null,
  max = 3,
): SwitcherCreator[] {
  const sel = selected ? creators.find((c) => c.handle === selected) ?? null : null;
  const rest = creators.filter((c) => c.handle !== sel?.handle).sort(byRecency);
  const ordered = sel ? [sel, ...rest] : rest;
  return ordered.slice(0, max);
}
