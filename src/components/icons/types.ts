import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from "react";

// Shared shape for the copy-in lucide-animated icons (pqoqubbw/icons). Each icon
// renders an SVG and exposes start/stopAnimation via ref, so an enclosing row/button
// can drive the hover animation instead of relying on the icon's own hover box.
export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export interface AnimatedIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

export type AnimatedIcon = ForwardRefExoticComponent<
  AnimatedIconProps & RefAttributes<AnimatedIconHandle>
>;
