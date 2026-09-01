import { bind, play, setEnabled, setVolume, type SoundName } from "cuelume";

export const INTERFACE_SOUND_VOLUME = 0.5;
export const SCRUB_SOUND_INTERVAL_MS = 40;

export function initializeInterfaceSounds(enabled: boolean): void {
  setVolume(INTERFACE_SOUND_VOLUME);
  setEnabled(enabled);
  bind();
}

export function setInterfaceSoundsEnabled(enabled: boolean): void {
  setEnabled(enabled);
}

export function playInterfaceSound(sound: SoundName): void {
  play(sound);
}

export interface ScrubSoundController {
  move: (key: string | number, now?: number) => boolean;
  reset: () => void;
}

export function createScrubSoundController({
  minIntervalMs = SCRUB_SOUND_INTERVAL_MS,
  sound = "tick",
  playSound = playInterfaceSound,
}: {
  minIntervalMs?: number;
  sound?: SoundName;
  playSound?: (sound: SoundName) => void;
} = {}): ScrubSoundController {
  let lastKey: string | number | null = null;
  let lastPlayedAt = Number.NEGATIVE_INFINITY;

  return {
    move(key, now = performance.now()) {
      if (key === lastKey) return false;
      lastKey = key;
      if (now - lastPlayedAt < minIntervalMs) return false;
      lastPlayedAt = now;
      playSound(sound);
      return true;
    },
    reset() {
      lastKey = null;
      lastPlayedAt = Number.NEGATIVE_INFINITY;
    },
  };
}
