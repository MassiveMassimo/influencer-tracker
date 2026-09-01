import { useState } from "react";
import type { SoundName } from "cuelume";
import { createScrubSoundController, type ScrubSoundController } from "#/lib/interface-sounds.ts";

export function useScrubSound(sound: SoundName = "tick"): ScrubSoundController {
  const [controller] = useState(() => createScrubSoundController({ sound }));
  return controller;
}
