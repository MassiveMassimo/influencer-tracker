import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { animate, useMotionValue } from "motion/react";
import { prefersReducedMotion } from "#/lib/reduced-motion.ts";
import { useMediaQuery } from "#/lib/use-media-query.ts";
import { lerp } from "#/lib/utils.ts";

export const W = 260; // rail width — matches w-[260px] / md:pl-[260px]; MobileNav's bar slides by this too

// Mobile reveal drawer with native-feel drag-to-close. The content panel
// translates right to uncover a static rail whose scale/fade/blur track the same
// progress p (1 = open, 0 = closed), so the rail recedes in sync with the slide —
// the mobile mirror of the desktop cover/reveal.
//
// The visual is written straight to two refs so a live drag never re-renders
// React; motion's spring settles the release carrying the fling velocity (the
// momentum that makes it feel native). Tap-to-open stays the caller's job.
//
// Desktop is untouched: paint() only runs on mobile open/close/drag, and the
// closed state clears the content transform entirely — so it never becomes a
// containing block for desktop's fixed descendants (e.g. the TOC minimap).
const TOGGLE_X = 208; // hamburger slide: top-bar slot (closed) → rail-header right (open)

export function useMobileDrawer() {
  // The drawer owns its own open/closed boolean (drives inert/aria/pointer-events
  // in __root). `progress` is the continuous drag timeline; this is the discrete
  // state — flipped by open()/settle() alongside the spring, next to the tap/drag/
  // escape dismissals so the whole open/close model lives in one place.
  const [isOpen, setIsOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)"); // md — matches the layout's md: split
  // Slide the pieces individually (scrim + panel here, top bar via motion in
  // MobileNav) rather than their shared column — a transform on an ANCESTOR breaks
  // position:sticky when the page is scrolled, so the column stays untransformed
  // and the sticky top bar transforms itself (pins, then offsets).
  const scrimRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Viewport-pinned faux bottom-left corner for the OPEN panel (__root's
  // .t-corner-notch). The panel's real hook-painted corner sits at its
  // document bottom — below the fold on a window-scrolled page — so this
  // fixed notch fakes it at the viewport bottom, tracking the slide.
  const cornerRef = useRef<HTMLDivElement>(null);
  const cornerTopRef = useRef<HTMLDivElement>(null);
  // Cached -panel.top for the creator stat-bar re-anchor (see paint). Scroll is
  // locked while open, so the panel's viewport offset can't change mid-open —
  // measure once per open and reuse, avoiding a per-frame reflow on the drag path.
  const barTop = useRef<number | null>(null);
  // Single source of truth for the whole open/close timeline (1 = open, 0 = closed).
  // The heavy/desktop-shared elements below are painted from it via a change
  // subscription; the React-rendered chrome (menu↔X icon, top-bar mark) binds the
  // SAME value with useTransform — so every piece interpolates on one timeline.
  const progress = useMotionValue(0);
  const drag = useRef<{ x0: number; moved: number } | null>(null);

  const paint = useCallback((v: number) => {
    const t = Math.min(v, 1); // rubber-band overshoot only moves the content, not the rail/toggle
    const scrim = scrimRef.current;
    const rail = railRef.current;
    const toggle = toggleRef.current;
    const panel = panelRef.current;
    // Clear (not translateX(0)) at rest so the closed panel casts no transform =
    // no containing block on desktop (would trap the fixed TOC minimap).
    // Measure the panel's viewport offset for the stat-bar re-anchor BEFORE any
    // style write this frame, so the once-per-open read hits clean layout (no
    // forced reflow). Scroll is locked while open, so it can't stale; the reset
    // to null (below, at rest) re-arms it for the next open.
    if (panel && v !== 0 && barTop.current === null) {
      barTop.current = -panel.getBoundingClientRect().top;
    }
    const slide = v === 0 ? "" : `translateX(${v * W}px)`;
    if (scrim) scrim.style.transform = slide;
    if (panel) {
      panel.style.transform = slide;
      // Re-anchor the creator stat bar: once the panel is transformed it becomes
      // the containing block for its position:fixed descendants, so the bar's
      // top:0 resolves to panel-top (scrolled off-screen) not viewport-top → it
      // vanishes. Feed it -panel.top (measured above) via a var the bar reads, so
      // it lands back at viewport-top and rides the translateX with the content.
      // The panel's REAL bottom-left corner is left square: below md it sits below
      // the fold (window-scrolled), so the fixed .t-corner-notch fakes it instead.
      if (v === 0) {
        barTop.current = null;
        panel.style.removeProperty("--drawer-bar-top");
      } else {
        panel.style.setProperty("--drawer-bar-top", `${barTop.current}px`);
      }
    }
    if (rail) {
      rail.style.transform = `scale(${lerp(0.92, 1, t)})`;
      rail.style.opacity = `${t}`;
      rail.style.filter = `blur(${(1 - t) * 12}px)`;
    }
    if (toggle) toggle.style.transform = t === 0 ? "" : `translateX(${t * TOGGLE_X}px)`;
    // Both faux corners (top-left + bottom-left) ride the panel's left edge on the
    // same slide (tracks rubber-band overshoot) and fade in with open progress —
    // closed stays full-bleed.
    for (const corner of [cornerRef.current, cornerTopRef.current]) {
      if (!corner) continue;
      corner.style.transform = slide;
      corner.style.opacity = `${t}`;
    }
  }, []);

  // Every frame of `progress` paints the ref-driven visuals.
  useEffect(() => {
    paint(progress.get());
    return progress.on("change", paint);
  }, [progress, paint]);

  // Freeze the CSS transition while JS/drag owns the value; thaw it after.
  const freeze = useCallback((frozen: boolean) => {
    for (const el of [
      scrimRef.current,
      railRef.current,
      toggleRef.current,
      panelRef.current,
      cornerRef.current,
      cornerTopRef.current,
    ]) {
      if (el) el.style.transition = frozen ? "none" : "";
    }
  }, []);

  const settle = useCallback(
    (to: 0 | 1, velocity: number) => {
      // Release inert/scrim at gesture commit, not spring-rest — else taps in the
      // content are dead for the ~300ms close settle (native drawers unlock on commit).
      if (to === 0) setIsOpen(false);
      if (prefersReducedMotion()) {
        progress.set(to);
        freeze(false);
        return;
      }
      animate(progress, to, {
        type: "spring",
        stiffness: 420,
        damping: 42,
        velocity,
        onComplete: () => freeze(false),
      });
    },
    [progress, freeze],
  );

  const open = useCallback(() => {
    freeze(true);
    setIsOpen(true); // scrim + inert engage immediately
    settle(1, 0);
  }, [freeze, settle]);

  const close = useCallback(() => {
    freeze(true);
    settle(0, 0);
  }, [freeze, settle]);

  // Escape closes — sits with the tap/drag dismissals rather than in __root.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  // Widening past md while open hands layout to the desktop CSS, but the inline
  // transforms paint() wrote (panel translateX, rail scale/blur) would linger and
  // shove the panel right, leaving a gap. Snap the drawer shut when md flips true:
  // set(0) runs paint(0), which clears every inline style back to the rest state.
  useEffect(() => {
    if (!isDesktop || !isOpen) return;
    drag.current = null; // abandon any in-flight drag so a dangling pointer can't repaint desktop
    progress.stop(); // skips settle()'s onComplete → thaw the frozen CSS transitions by hand
    progress.set(0); // → paint(0) clears the inline transforms
    freeze(false);
    setIsOpen(false);
  }, [isDesktop, isOpen, progress, freeze]);

  // Background scroll-lock while open. Deliberately NOT a layout lock: both
  // html/body overflow:hidden and the position:fixed-body technique collapse
  // the root's scrollable overflow, clamping scrollY to 0 — which detaches the
  // sticky bars and yanks every root scroll-driven timeline (ticker shrink,
  // creator-bar reveal) to progress 0 for the whole open period. The scrim's
  // touch-action:none already stops touch pans that start on it; this cancels
  // what that can't reach — wheel/trackpad, scroll keys, and touch pans
  // chaining to the window from the uncovered rail strip. Window listeners for
  // wheel/touchmove are passive by default, so passive:false is load-bearing.
  // Events inside the rail pass through (its nav scroller + arrow-key nav keep
  // working); scroll keys are only cancelled when nothing is focused (target =
  // body/html), so Space still activates the focused toggle button.
  useEffect(() => {
    if (!isOpen) return;
    const inRail = (t: EventTarget | null) =>
      t instanceof Node && railRef.current?.contains(t) === true;
    const block = (e: Event) => {
      if (!inRail(e.target)) e.preventDefault();
    };
    const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
    const blockKeys = (e: KeyboardEvent) => {
      if (
        scrollKeys.has(e.key) &&
        (e.target === document.body || e.target === document.documentElement)
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("wheel", block, { passive: false });
    window.addEventListener("touchmove", block, { passive: false });
    window.addEventListener("keydown", blockKeys);
    return () => {
      window.removeEventListener("wheel", block);
      window.removeEventListener("touchmove", block);
      window.removeEventListener("keydown", blockKeys);
    };
  }, [isOpen]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!e.isPrimary) return; // ignore a 2nd finger — it would reset the drag origin mid-drag
      e.currentTarget.setPointerCapture(e.pointerId);
      progress.stop(); // halt any in-flight settle so the drag's set() doesn't fight the spring
      freeze(true);
      drag.current = { x0: e.clientX, moved: 0 };
    },
    [progress, freeze],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      d.moved = Math.max(d.moved, Math.abs(dx));
      // dx < 0 closes; dx > 0 (dragged past open) gets a stiff rubber-band.
      const raw = 1 + dx / W;
      progress.set(raw > 1 ? 1 + (raw - 1) * 0.2 : Math.max(raw, 0));
    },
    [progress],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      // MotionValue tracks its own velocity (progress-units/s) from the drag's
      // set() calls. Manual lastX sampling was always ~0 — pointerup repeats the
      // final move's coords, so e.clientX - lastX ≈ 0 and the flick never fired.
      const v = progress.getVelocity();
      const pos = Math.max(Math.min(1 + (e.clientX - d.x0) / W, 1), 0);
      // A tap (no real travel) closes, matching the old tap-scrim behaviour; a
      // clear flick wins over position, else settle to whichever half it's past.
      // 1.35 ≈ 350px/s over the 260px rail.
      const toOpen = d.moved < 6 ? false : v > 1.35 ? true : v < -1.35 ? false : pos > 0.5;
      settle(toOpen ? 1 : 0, v);
    },
    [progress, settle],
  );

  return {
    isOpen,
    progress,
    scrimRef,
    railRef,
    toggleRef,
    panelRef,
    cornerRef,
    cornerTopRef,
    open,
    close,
    scrimHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
