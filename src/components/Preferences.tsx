import { ScrollTextIcon, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Dialog } from "@base-ui/react/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "#/components/ui/drawer.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { ThemePicker } from "./ThemePicker";
import { BadgeStylePicker } from "./BadgeStylePicker";
import { usePreferences, isThemeTransitioning } from "#/lib/preferences.tsx";
import { useHaptics } from "#/lib/haptics.tsx";
import { useMediaQuery } from "#/lib/use-media-query.ts";
import { useSurface, SurfaceProvider } from "#/lib/surface-context.tsx";
import { surfaceClasses } from "#/lib/surface-classes.ts";
import { cn } from "#/lib/utils.ts";

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex cursor-pointer flex-col" onClick={() => onChange(!checked)}>
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch
        label={label}
        checked={checked}
        onToggle={() => onChange(!checked)}
        className="[&>span:last-child]:sr-only"
      />
    </div>
  );
}

function Body({ onClose, isDesktop }: { onClose: () => void; isDesktop: boolean }) {
  const {
    reduceMotion,
    reduceHaptics,
    showHalalStatus,
    setReduceMotion,
    setReduceHaptics,
    setShowHalalStatus,
  } = usePreferences();
  const { impact } = useHaptics();
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          Theme
        </div>
        <ThemePicker />
      </div>
      <Separator />
      <div className="space-y-2">
        <div className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground uppercase">
          Badge style
        </div>
        <BadgeStylePicker />
      </div>
      <Separator />
      <div className="space-y-4">
        <SwitchRow
          label="Reduce motion"
          description="Minimize animations and transitions."
          checked={reduceMotion}
          onChange={setReduceMotion}
        />
        {/* Haptics are touch-only; hide on desktop where there's no vibration. */}
        {!isDesktop && (
          <SwitchRow
            label="Reduce haptics"
            description="Turn off vibration feedback."
            checked={reduceHaptics}
            onChange={(v) => {
              // Fire one last tap when re-enabling, for confirmation.
              if (!v) impact();
              setReduceHaptics(v);
            }}
          />
        )}
        <SwitchRow
          label="Show halal status"
          description="Badge stocks with their Musaffa Shariah-compliance rating."
          checked={showHalalStatus}
          onChange={setShowHalalStatus}
        />
      </div>
      <Separator />
      <Link
        to="/changelog"
        onClick={onClose}
        className="group flex items-center justify-between gap-4 no-underline"
      >
        <span className="flex flex-col">
          <span className="text-sm font-medium text-foreground group-hover:underline group-hover:underline-offset-2">
            Changelog
          </span>
          <span className="text-xs text-muted-foreground">What's new and recently shipped.</span>
        </span>
        <ScrollTextIcon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </Link>
    </div>
  );
}

export function Preferences({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  // Dialog lifts +4 above its substrate (FF convention) and provides that level
  // to descendants so nested overlays stay visible at the right depth.
  const dialogLevel = Math.min(useSurface() + 4, 8);

  // A theme switch runs a ~1s view transition; a click in that window can bounce
  // focus to <body>, and Base UI closes the dialog on focus-out. Veto the close
  // while the transition is animating (intentional closes after it work fine).
  const handleOpenChange = (o: boolean) => {
    if (!o && isThemeTransitioning()) return;
    onOpenChange(o);
  };

  if (isDesktop) {
    return (
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup
            className={cn(
              "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 transition-all duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              surfaceClasses(dialogLevel),
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-base font-medium">Preferences</Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Theme, motion, and haptics settings.
            </Dialog.Description>
            <SurfaceProvider value={dialogLevel}>
              <Body onClose={() => onOpenChange(false)} isDesktop />
            </SurfaceProvider>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent className={cn("h-[70vh]", surfaceClasses(dialogLevel))}>
        <div className="px-5 pt-2 pb-8">
          <DrawerTitle className="mb-4 text-base font-medium">Preferences</DrawerTitle>
          <DrawerDescription className="sr-only">
            Theme, motion, and haptics settings.
          </DrawerDescription>
          <SurfaceProvider value={dialogLevel}>
            <Body onClose={() => onOpenChange(false)} isDesktop={false} />
          </SurfaceProvider>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
