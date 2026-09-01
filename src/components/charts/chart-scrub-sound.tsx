"use client";

import { useEffect } from "react";
import { useScrubSound } from "#/hooks/use-scrub-sound.ts";
import { useChartHover } from "./chart-context.tsx";

export function ChartScrubSound() {
  const { tooltipData } = useChartHover();
  const scrubSound = useScrubSound();
  const index = tooltipData?.index;

  useEffect(() => {
    if (index == null) scrubSound.reset();
    else scrubSound.move(index);
  }, [index, scrubSound]);

  return null;
}
