import type { ReactNode } from 'react';

/**
 * AmbientShape: reusable decorative depth slot for landing sections. Renders
 * one blurred wireframe SVG silhouette (quiet 3D line art, not an icon) plus
 * a soft brand glow, with a slow transform-only float loop (gated off under
 * prefers-reduced-motion). The blur gives a shallow depth-of-field so the
 * shape sits behind the section content instead of competing with it.
 *
 * Purely decorative: aria-hidden, pointer-events-none. Colors come from the
 * blueprint wire desaturations in @theme, never a new hue.
 */

type ShapeName = 'cube' | 'arch' | 'hex' | 'brackets' | 'orbits';

const SHAPES: Record<ShapeName, ReactNode> = {
  /** Isometric cube, three visible faces. */
  cube: (
    <g
      stroke="var(--color-blueprint-wire-strong)"
      strokeOpacity="0.7"
      strokeWidth="1.5"
      fill="none"
    >
      <polygon points="50,16 94,38 50,60 6,38" />
      <polygon points="50,60 94,38 94,94 50,116" />
      <polygon points="6,38 50,60 50,116 6,94" />
      <line x1="50" y1="16" x2="50" y2="60" strokeOpacity="0.35" />
    </g>
  ),
  /** Archway, the classic drafting profile. */
  arch: (
    <g
      stroke="var(--color-blueprint-wire-strong)"
      strokeOpacity="0.7"
      strokeWidth="1.5"
      fill="none"
    >
      <path d="M18 118 V58 a32 32 0 0 1 64 0 V118" />
      <path d="M34 118 V58 a16 16 0 0 1 32 0 V118" strokeOpacity="0.35" />
      <line x1="18" y1="118" x2="98" y2="118" strokeOpacity="0.5" />
    </g>
  ),
  /** Hex nut: hexagon with a through-hole. */
  hex: (
    <g
      stroke="var(--color-blueprint-wire-strong)"
      strokeOpacity="0.7"
      strokeWidth="1.5"
      fill="none"
    >
      <polygon points="58,8 98,32 98,82 58,106 18,82 18,32" />
      <circle cx="58" cy="57" r="22" strokeOpacity="0.5" />
      <circle cx="58" cy="57" r="8" strokeOpacity="0.35" />
    </g>
  ),
  /** Drafting corner brackets framing an open quadrant. */
  brackets: (
    <g
      stroke="var(--color-blueprint-wire-strong)"
      strokeOpacity="0.7"
      strokeWidth="1.5"
      fill="none"
    >
      <path d="M8 40 V16 a8 8 0 0 1 8-8 H40" />
      <path d="M88 40 V16 a8 8 0 0 0-8-8 H56" />
      <path d="M8 74 V98 a8 8 0 0 0 8 8 H40" />
      <path d="M88 74 V98 a8 8 0 0 1-8 8 H56" />
      <line x1="48" y1="66" x2="48" y2="48" strokeOpacity="0.3" />
      <circle cx="48" cy="40" r="2.5" fill="var(--color-blueprint-wire-strong)" stroke="none" />
    </g>
  ),
  /** Orbit rings: concentric ellipses at a slight tilt. */
  orbits: (
    <g
      stroke="var(--color-blueprint-wire-strong)"
      strokeOpacity="0.6"
      strokeWidth="1.25"
      fill="none"
    >
      <ellipse cx="52" cy="62" rx="46" ry="24" />
      <ellipse cx="52" cy="62" rx="30" ry="15" strokeOpacity="0.5" />
      <ellipse cx="52" cy="62" rx="14" ry="7" strokeOpacity="0.35" />
      <line x1="6" y1="62" x2="98" y2="62" strokeOpacity="0.3" />
    </g>
  ),
};

export function AmbientShape({
  shape,
  className = '',
  size = 140,
  glow = 'brand',
  float = true,
  soft = false,
}: {
  shape: ShapeName;
  className?: string;
  /** ViewBox side length in px (the svg is square). */
  size?: number;
  /** Glow tint: brand blue or a neutral ink wash. */
  glow?: 'brand' | 'ink';
  float?: boolean;
  /** Softer treatment for lower sections: heavier blur + less presence. */
  soft?: boolean;
}) {
  const isSoft = soft ?? false;

  return (
    <div aria-hidden className={`pointer-events-none absolute ${className}`}>
      <div className={float ? 'animate-ambient-float' : ''}>
        <div
          className="animate-ambient-pulse absolute"
          style={{
            inset: '-30%',
            background:
              glow === 'brand'
                ? 'radial-gradient(circle, rgba(26, 107, 255, 0.16) 0%, rgba(26, 107, 255, 0.05) 55%, transparent 75%)'
                : 'radial-gradient(circle, rgba(10, 15, 30, 0.09) 0%, transparent 70%)',
          }}
        />
        <svg
          width={size}
          height={size}
          viewBox="0 0 116 116"
          fill="none"
          style={{
            filter: isSoft ? 'blur(3px)' : 'blur(1.5px)',
            opacity: isSoft ? 0.5 : 0.85,
          }}
        >
          {SHAPES[shape]}
        </svg>
      </div>
    </div>
  );
}
