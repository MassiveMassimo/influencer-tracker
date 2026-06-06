"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "#/lib/utils.ts";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-colors",
        "h-[calc(var(--thumb-size)+4px)] w-[calc(var(--thumb-size)*2+2px)] p-px",
        "[--thumb-size:--spacing(5)] sm:[--thumb-size:--spacing(4)]",
        "bg-input data-[checked]:bg-primary",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[var(--thumb-size)] rounded-full bg-background shadow-sm ring-0 transition-transform",
          "data-[unchecked]:translate-x-0 data-[checked]:translate-x-[calc(var(--thumb-size))]"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
