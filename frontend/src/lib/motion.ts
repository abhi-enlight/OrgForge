/**
 * Forge motion tokens — the JS twin of the CSS motion tokens in
 * globals.css (@theme --ease-spring). Framer-motion cannot consume CSS
 * variables, so these live here as the single source of truth. Never
 * hand-type a bezier in a component.
 */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
/** Entering/exiting UI: modals, toasts, popovers, cards. Matches --ease-spring. */
export const EASE_REVEAL: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** Scroll reveals and list entrances (Reveal, StageTimeline, workspace stage swaps). */
