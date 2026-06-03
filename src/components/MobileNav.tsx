import { useState } from "react";
import { LineChartIcon, MenuIcon } from "lucide-react";
import GitHubLink from "./GitHubLink";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { type CreatorRef, RailContent } from "./WorkspaceRail";

// Mobile-only top bar (hidden at md+). Hosts the menu trigger and app mark; the
// rail content lives in a left drawer with vaul's background scale-down.
export function MobileNav({ creators }: { creators: CreatorRef[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-border/60 bg-background/80 px-3 py-2 backdrop-blur md:hidden">
      <Drawer
        direction="left"
        shouldScaleBackground
        open={open}
        onOpenChange={setOpen}
      >
        <DrawerTrigger asChild>
          <button
            type="button"
            aria-label="Open navigation"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <MenuIcon className="size-[18px]" />
          </button>
        </DrawerTrigger>
        <DrawerContent className="p-0">
          <DrawerTitle className="sr-only">Navigation</DrawerTitle>
          <DrawerDescription className="sr-only">
            Primary navigation and tracked creators
          </DrawerDescription>
          <RailContent creators={creators} onNavigate={() => setOpen(false)} />
        </DrawerContent>
      </Drawer>

      <div className="flex items-center gap-2">
        <div className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-foreground/80 to-foreground/40 ring-1 ring-border/60">
          <LineChartIcon className="size-3.5 text-background" />
        </div>
        <span className="font-medium text-sm text-foreground">
          Signal Tracker
        </span>
      </div>

      <GitHubLink className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground" />
    </div>
  );
}
