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

// Avatar tabs for the switcher: a stable most-recent-first roster so switching
// between the shown creators only moves the active indicator, never reorders the
// tabs. A selected caller outside the top `max` is surfaced in the last slot so
// the more-recent tabs keep their fixed positions.
export function pickAvatarTabs(
  creators: SwitcherCreator[],
  selected: string | null,
  max = 3,
): SwitcherCreator[] {
  const ranked = [...creators].sort(byRecency);
  const top = ranked.slice(0, max);
  const sel = selected ? ranked.find((c) => c.handle === selected) ?? null : null;
  if (!sel || top.some((c) => c.handle === sel.handle)) return top;
  return [...ranked.slice(0, max - 1), sel];
}
