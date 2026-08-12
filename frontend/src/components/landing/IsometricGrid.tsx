/**
 * IsometricGrid: a hand-drawn SVG isometric grid plane (the "3D drafting
 * table" motif behind the LivePipeline stage and the CTA anchor). Lines run
 * at 30 degrees so the diamond mesh reads as a plane receding into the
 * background; the whole layer drifts slowly on a transform-only CSS loop
 * (gated off under prefers-reduced-motion).
 *
 * Purely decorative: aria-hidden, pointer-events-none, no layout impact.
 * Colors are the neutral blueprint desaturations from @theme, never a hue.
 */
export function IsometricGrid({
  className = '',
  strong = false,
}: {
  className?: string;
  /** Stronger stroke presence for the hero stage (softer elsewhere). */
  strong?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <svg
        className="animate-blueprint-drift h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <g
          stroke="var(--color-blueprint-wire)"
          strokeOpacity={strong ? 0.85 : 0.55}
          strokeWidth={strong ? 1.25 : 1}
        >
          {/* Receding plane: lines descending left and right from a center
              vanishing line, fanned so the diamond mesh grows toward the
              bottom edge (closest to the viewer). */}
          {Array.from({ length: 17 }, (_, i) => {
            const x = 600 + (i - 8) * 46;
            return (
              <line key={`l${i}`} x1={x} y1={-40} x2={x - 760} y2={840} />
            );
          })}
          {Array.from({ length: 17 }, (_, i) => {
            const x = 600 + (i - 8) * 46;
            return (
              <line key={`r${i}`} x1={x} y1={-40} x2={x + 760} y2={840} />
            );
          })}
          {/* Cross lines: horizontal drafting hairlines that complete the
              diamond cells, denser near the bottom (foreground). */}
          {Array.from({ length: 13 }, (_, i) => {
            const y = -40 + i * 68;
            return (
              <line key={`h${i}`} x1={-160} y1={y} x2={1360} y2={y} />
            );
          })}
        </g>

        {/* Two stronger axial lines framing the plane (major gridline role). */}
        <g
          stroke="var(--color-blueprint-wire-strong)"
          strokeOpacity={strong ? 0.75 : 0.5}
          strokeWidth={strong ? 1.5 : 1.25}
        >
          <line x1={600} y1={-40} x2={-160} y2={840} />
          <line x1={600} y1={-40} x2={1360} y2={840} />
        </g>
      </svg>
    </div>
  );
}
