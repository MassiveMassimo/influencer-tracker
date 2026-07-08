// src/components/grade-medallion.tsx
// Grade letter (Fraunces, max axes) inside a spinning shimmer ring of the persona
// label. On a creator switch the letter and ring each run the .t-text-swap phase
// swap (via useTextSwap) so the medallion animates in step with the header handle.
// Shimmer pattern from @ncdai's spinning-circular-text example, adapted to
// motion/react + our preferences theme (restart key re-resolves the CSS color vars).
import { motion, useAnimationFrame, useMotionValue, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SpinningCircularText } from "#/components/spinning-circular-text";
import { useTextSwap } from "#/components/text-swap";
import { usePreferences } from "#/lib/preferences";
import type { Grade } from "#/lib/grade";

// Ring char count sets the medallion diameter (--sc-char-count drives --sc-container-size
// in SpinningCircularText). Repeat "LABEL • " then clamp to a FIXED length so every
// persona yields the same diameter — otherwise a longer/shorter label changes the circle
// size and a creator switch jumps the header layout. Fixed length = only the text swaps.
const RING_CHARS = 38;
function ringText(label: string): string {
  const unit = `${label} • `.toUpperCase();
  return unit.repeat(Math.ceil(RING_CHARS / unit.length)).slice(0, RING_CHARS);
}

export function GradeMedallion({
  grade,
  fontSize = "0.5rem",
  letterClassName = "text-2xl",
  active = true,
}: {
  grade: Grade;
  // Ring char size + letter size — shrunk in the mobile grid cell so the
  // medallion's box matches a stat tile's height (header uses the defaults).
  fontSize?: string;
  letterClassName?: string;
  // False for the off-screen duplicate (header vs mobile-cell) — freezes the spin +
  // shimmer so the hidden copy doesn't run infinite tweens every frame.
  active?: boolean;
}) {
  const osReduce = useReducedMotion();
  const { reduceMotion } = usePreferences();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // The OS reduce-motion signal is applied post-mount so the first client render matches SSR.
  // `frozen` also holds for the hidden duplicate (active === false).
  const still = (mounted && osReduce === true) || reduceMotion;
  const frozen = still || !active;

  // Letter and ring swap independently: switching between two creators with the
  // same grade animates only the persona ring, and vice versa.
  const letter = useTextSwap<HTMLSpanElement>(grade.grade);
  const ring = useTextSwap<HTMLDivElement>(grade.label);
  const text = useMemo(() => ringText(ring.display), [ring.display]);

  // Hover flourish (desktop): the ring bursts to a fast spin then eases back to its
  // lazy idle speed while the whole medallion grows a touch. Rotation is a motion
  // value advanced per-frame (speed eased toward a target) instead of swapping a CSS
  // animation-duration — smooth spin-up, no jank. Skipped when still.
  const IDLE = -26; // deg/s, negative = counter-clockwise
  const BOOST = -190;
  const rotate = useMotionValue(0);
  const speed = useRef(IDLE);
  const target = useRef(IDLE);
  const [hovered, setHovered] = useState(false);
  const boostTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(boostTimer.current), []);
  useAnimationFrame((_, delta) => {
    if (frozen) return;
    const dt = Math.min(delta, 64) / 1000; // clamp tab-switch frame gaps
    speed.current += (target.current - speed.current) * Math.min(1, dt * 4);
    rotate.set(rotate.get() + speed.current * dt);
  });
  const onEnter = () => {
    if (frozen) return;
    setHovered(true);
    target.current = BOOST;
    clearTimeout(boostTimer.current);
    boostTimer.current = setTimeout(() => (target.current = IDLE), 500);
  };
  const onLeave = () => {
    setHovered(false);
    target.current = IDLE;
    clearTimeout(boostTimer.current);
  };

  return (
    <div
      className="relative grid place-items-center transition-transform duration-300 ease-out"
      style={{
        transform: hovered ? "scale(1.08)" : "scale(1)",
        transitionDelay: hovered ? "120ms" : "0ms",
      }}
      // Pointer (not mouse) events + a touch guard so a tap on the mobile cell
      // doesn't latch the hover scale (no mouseleave follows a tap).
      onPointerEnter={(e) => e.pointerType !== "touch" && onEnter()}
      onPointerLeave={onLeave}
    >
      <motion.div
        ref={ring.ref}
        className="t-medallion-ring"
        style={{ rotate }}
        // Drives the pure-CSS shimmer (.t-medallion-char in styles.css): present =
        // hold every char at --shimmering-color, absent = run the staggered color wave.
        // Replaces the old 38 per-char motion.js color tweens (the dominant paint cost).
        data-frozen={frozen ? "" : undefined}
      >
        <SpinningCircularText
          aria-hidden
          spin={false}
          text={text}
          charSpacing={1.2}
          fontSize={fontSize}
          className="tracking-normal text-muted-foreground [--color:var(--muted-foreground)] [--shimmering-color:var(--foreground)]"
          renderChar={(char) => <span className="t-medallion-char">{char}</span>}
        />
      </motion.div>
      <span
        ref={letter.ref}
        aria-hidden
        className={`t-text-swap display-title absolute rotate-6 leading-none ${letterClassName}`}
        style={{ fontVariationSettings: "'opsz' 144, 'wght' 900, 'SOFT' 100, 'WONK' 1" }}
      >
        {letter.display}
      </span>
      <span className="sr-only">{`Grade ${grade.grade} — ${grade.label}`}</span>
    </div>
  );
}
