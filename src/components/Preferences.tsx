import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "#/components/ui/drawer.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { ThemePicker } from "./ThemePicker";
import { usePreferences, isThemeTransitioning } from "#/lib/preferences.tsx";
import { useHaptics } from "#/lib/haptics.tsx";
import { useMediaQuery } from "#/lib/use-media-query.ts";

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
    <label className="flex items-center justify-between gap-4">
      <span className="flex flex-col">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Body() {
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
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Theme
        </div>
        <ThemePicker />
      </div>
      <Separator />
      <div className="space-y-4">
        <SwitchRow
          label="Reduce motion"
          description="Minimize animations and transitions."
          checked={reduceMotion}
          onChange={setReduceMotion}
        />
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
        <SwitchRow
          label="Show halal status"
          description="Badge stocks with their Musaffa Shariah-compliance rating."
          checked={showHalalStatus}
          onChange={setShowHalalStatus}
        />
      </div>
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
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-background p-6 shadow-xl transition-all duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
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
            <Body />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange} shouldScaleBackground>
      <DrawerContent className="h-[70vh]">
        <div className="px-5 pt-2 pb-8">
          <DrawerTitle className="mb-4 text-base font-medium">Preferences</DrawerTitle>
          <DrawerDescription className="sr-only">
            Theme, motion, and haptics settings.
          </DrawerDescription>
          <Body />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
