"use client";

import Scritto from "@scritto/react";
import { usePreferences } from "#/lib/preferences.tsx";

export interface ScrittoNumberProps {
  value: number;
  format: Intl.NumberFormatOptions;
}

export interface ScrittoTextProps {
  value: string;
  className?: string;
}

export function ScrittoText({ value, className }: ScrittoTextProps) {
  const { reduceMotion } = usePreferences();

  return <Scritto animated={!reduceMotion} className={className} value={value} />;
}

export function ScrittoNumber({ value, format }: ScrittoNumberProps) {
  const formatted = new Intl.NumberFormat("en-US", format).format(value);

  return <ScrittoText value={formatted} />;
}
