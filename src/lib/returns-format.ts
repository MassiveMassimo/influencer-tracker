// Shared signed-percent + tone-color formatters for excess-return figures.
// Used by the ticker route and the compare table; kept in lib (not a component)
// so importers don't form a cycle.

export function signed(x: number | null): string {
  return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

export function toneClass(x: number | null): string {
  if (x == null) return "text-muted-foreground";
  return x > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : x < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
}
