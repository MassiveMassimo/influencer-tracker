import { CheckIcon } from "lucide-react";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { usePreferences, type BadgeStyle } from "#/lib/preferences.tsx";
import { useHaptics } from "#/lib/haptics.tsx";
import { cn } from "#/lib/utils.ts";
import { BadgeShapePreview } from "#/components/trait-badges.tsx";
import { ALL_TRAITS } from "#/lib/traits";

// Use the Calibrated trait (target-arrow, teal rosette) as the preview example.
const PREVIEW_TRAIT = ALL_TRAITS.find((t) => t.id === "calibrated") ?? ALL_TRAITS[0];

const OPTIONS: { value: BadgeStyle; label: string }[] = [
  { value: "enamel", label: "Enamel" },
  { value: "candy", label: "Candy" },
];

export function BadgeStylePicker() {
  const { badgeStyle, setBadgeStyle } = usePreferences();
  const { impact } = useHaptics();

  return (
    <ToggleGroup
      value={[badgeStyle]}
      onValueChange={(v: string[]) => {
        const next = v[0] as BadgeStyle | undefined;
        if (next && next !== badgeStyle) {
          impact();
          setBadgeStyle(next);
        }
      }}
      className="grid grid-cols-2 gap-3"
    >
      {OPTIONS.map((o) => (
        <Toggle
          key={o.value}
          value={o.value}
          aria-label={o.label}
          className={cn(
            "group relative flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-2 transition-all",
            "hover:border-border data-[pressed]:border-primary data-[pressed]:ring-2 data-[pressed]:ring-primary/30",
          )}
        >
          <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md">
            <BadgeShapePreview trait={PREVIEW_TRAIT} size={48} style={o.value} />
          </div>
          <span className="text-center text-xs font-medium text-foreground">{o.label}</span>
          <span className="absolute top-2 right-2 hidden size-4 items-center justify-center rounded-full bg-primary text-primary-foreground group-data-[pressed]:flex">
            <CheckIcon className="size-2.5" />
          </span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
