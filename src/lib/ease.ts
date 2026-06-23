// Shared strong ease-out curve for UI motion, so the chart morph, bar grow, and
// icon/badge slides + entrances all read as one hand. Stronger than the built-in
// CSS/motion easings, which start too softly. Typed as a fixed 4-tuple so it
// satisfies motion's `ease` cubic-bezier input directly.
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
