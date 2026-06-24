import * as React from "react";
import { CheckIcon } from "lucide-react";
// Uses the raw Base UI primitive (not the coss ui/toggle-group pill button) so
// the preview-card layout — flex-col card + full-size SVG illustration — isn't
// overridden by coss's fixed-height/centered/svg-shrinking toggle styling.
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import {
  usePreferences,
  setThemeTransitioning,
  type ThemeMode,
} from "#/lib/preferences.tsx";
import { useHaptics } from "#/lib/haptics.tsx";
import { cn } from "#/lib/utils.ts";

// Fixed palettes so each preview shows its own theme regardless of active theme.
const LIGHT = { bg: "#ffffff", rail: "#f3f4f6", line: "#111827", muted: "#d1d5db" };
const DARK = { bg: "#0a0a0a", rail: "#1a1a1a", line: "#e5e7eb", muted: "#374151" };

function MiniDashboard({ p }: { p: typeof LIGHT }) {
  return (
    <div className="flex h-full w-full overflow-hidden rounded-md" style={{ background: p.bg }}>
      <div className="h-full w-1/4" style={{ background: p.rail }}>
        <div className="mx-1.5 mt-2 h-1 rounded-full" style={{ background: p.muted }} />
        <div className="mx-1.5 mt-1 h-1 w-2/3 rounded-full" style={{ background: p.muted }} />
      </div>
      <div className="flex-1 p-2">
        <svg viewBox="0 0 40 20" className="h-full w-full" preserveAspectRatio="none">
          <polyline
            points="0,16 8,12 16,14 24,6 32,9 40,3"
            fill="none"
            stroke={p.line}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}

const OPTIONS: { value: ThemeMode; label: string; node: React.ReactNode }[] = [
  { value: "light", label: "Light", node: <MiniDashboard p={LIGHT} /> },
  { value: "dark", label: "Dark", node: <MiniDashboard p={DARK} /> },
  {
    value: "auto",
    label: "System",
    node: (
      <div className="relative h-full w-full">
        <div className="absolute inset-0" style={{ clipPath: "polygon(0 0, 100% 0, 0 100%)" }}>
          <MiniDashboard p={LIGHT} />
        </div>
        <div className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
          <MiniDashboard p={DARK} />
        </div>
      </div>
    ),
  },
];

export function ThemePicker() {
  const { theme, setTheme, reduceMotion } = usePreferences();
  const { impact } = useHaptics();
  // While the 1s blurred-circle reveal plays, disable the *other* options.
  // Starting a second transition mid-reveal aborts the first (InvalidStateError)
  // and the snapshot teardown drops focus to <body>, tripping the dialog's
  // focus-outside dismiss. Keeping the selected (focused) button enabled means
  // focus never escapes the dialog.
  const [pending, setPending] = React.useState(false);

  const change = (next: ThemeMode) => {
    impact();
    // Blurred-circle reveal via the View Transitions API (chanhdai.com
    // "Circle Blur"); the animation is pure CSS on ::view-transition-new(root)
    // in styles.css. setTheme mutates <html> synchronously inside the callback.
    const start = (
      document as Document & {
        startViewTransition?: (cb: () => void) => { finished: Promise<unknown> };
      }
    ).startViewTransition;
    if (reduceMotion || typeof start !== "function") {
      setTheme(next);
      return;
    }
    setPending(true);
    setThemeTransitioning(true);
    start
      .call(document, () => setTheme(next))
      .finished.catch(() => {})
      .finally(() => {
        setPending(false);
        setThemeTransitioning(false);
      });
  };

  return (
    <ToggleGroup
      value={[theme]}
      onValueChange={(v: string[]) => {
        const next = v[0] as ThemeMode | undefined;
        if (next && next !== theme) change(next);
      }}
      className="grid grid-cols-3 gap-3"
    >
      {OPTIONS.map((o) => (
        <Toggle
          key={o.value}
          value={o.value}
          aria-label={o.label}
          // Lock the other options during the reveal; the selected one stays
          // enabled so focus never leaves the dialog. See `pending` above.
          disabled={pending && o.value !== theme}
          className={cn(
            "group relative flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-2 transition-all",
            "hover:border-border data-[pressed]:border-primary data-[pressed]:ring-2 data-[pressed]:ring-primary/30",
            // Locked during the reveal but visually unchanged (no fade).
            "disabled:pointer-events-none"
          )}
        >
          <div className="aspect-[4/3] w-full overflow-hidden rounded-md ring-1 ring-border/40">
            {o.node}
          </div>
          <span className="text-center text-xs font-medium text-foreground">{o.label}</span>
          <span className="absolute right-2 top-2 hidden size-4 items-center justify-center rounded-full bg-primary text-primary-foreground group-data-[pressed]:flex">
            <CheckIcon className="size-2.5" />
          </span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
