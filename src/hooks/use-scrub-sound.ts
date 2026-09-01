import { useRef } from "react";
import { createScrubSoundController, type ScrubSoundController } from "#/lib/interface-sounds.ts";

export function useScrubSound(): ScrubSoundController {
  const controller = useRef<ScrubSoundController | null>(null);
  if (!controller.current) controller.current = createScrubSoundController();
  return controller.current;
}
