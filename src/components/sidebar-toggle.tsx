"use client";

import { useRef } from "react";
import { Button } from "#/components/ui/button.tsx";
import { PanelLeftCloseIcon } from "#/components/icons/panel-left-close.tsx";
import { PanelLeftOpenIcon } from "#/components/icons/panel-left-open.tsx";
import type { AnimatedIconHandle } from "#/components/icons/types.ts";

// FF ghost icon-button that toggles the desktop rail. The animated lucide icon is
// ref-driven on button hover (not its own hover box), matching the nav-item
// pattern. Single instance in __root's overlay layer; it slides via CSS
// translate-x between the rail header (open) and the collapsed top-left.
export function SidebarToggle({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  const Icon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      aria-controls="workspace-rail"
      onClick={onClick}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      <Icon ref={iconRef} size={16} />
    </Button>
  );
}
