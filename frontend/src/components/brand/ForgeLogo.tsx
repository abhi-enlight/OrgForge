import Link from 'next/link';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: { tile: 'h-5 w-5', wordmark: 'text-[10px]', gap: 'gap-2' },
  md: { tile: 'h-7 w-7', wordmark: 'text-sm', gap: 'gap-2.5' },
  lg: { tile: 'h-10 w-10', wordmark: 'text-base', gap: 'gap-3' },
} as const;

type LogoSize = keyof typeof SIZES;

interface ForgeLogoProps {
  /** Where the logo navigates to when clicked. */
  href: string;
  size?: LogoSize;
  className?: string;
  wordmarkClassName?: string;
  showWordmark?: boolean;
  ariaLabel?: string;
}

/**
 * Forge brand lockup: a gradient tile (brand blue → deep navy) carrying the
 * landing page's blueprint dot-grid motif with a white forge-spark mark, next
 * to the FORGE wordmark. Inline SVG so it stays crisp at any size; the whole
 * lockup is a link. The tile picks up a gentle lift + tilt on hover.
 */
export function ForgeLogo({
  href,
  size = 'md',
  className,
  wordmarkClassName,
  showWordmark = true,
  ariaLabel = 'Forge, by Enlight Lab',
}: ForgeLogoProps) {
  const s = SIZES[size];

  return (
    <Link href={href} aria-label={ariaLabel} className={cn('group inline-flex items-center', s.gap, className)}>
      <span
        aria-hidden="true"
        className={cn(
          'relative block shrink-0 overflow-hidden rounded-[30%]',
          'bg-gradient-to-br from-[#4d8bff] via-brand-blue to-[#0b1d47]',
          'shadow-soft ring-1 ring-inset ring-white/25',
          'transition-transform duration-200 group-hover:scale-105 group-hover:rotate-6',
          'motion-reduce:transition-none motion-reduce:group-hover:rotate-0',
          s.tile
        )}
      >
        {/* Blueprint dot grid inside the tile (ties the mark to the landing
            page's "Live Blueprint" motif) — scales with the tile. */}
        <span
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.5) 1px, transparent 1px)',
            backgroundSize: '25% 25%',
          }}
        />
        {/* Forge spark — concave 4-point star + two satellites */}
        <svg viewBox="0 0 32 32" className="absolute inset-0 h-full w-full">
          <path
            d="M16 7.4 C17.1 13, 19 14.9, 24.6 16 C19 17.1, 17.1 19, 16 24.6 C14.9 19, 13 17.1, 7.4 16 C13 14.9, 14.9 13, 16 7.4 Z"
            fill="#fff"
          />
          <circle cx="24.2" cy="8.2" r="1.6" fill="#fff" />
          <circle cx="8.6" cy="23.8" r="1.1" fill="#fff" opacity="0.85" />
        </svg>
      </span>

      {showWordmark && (
        <span
          className={cn(
            'font-bold tracking-[0.25em] text-brand-dark transition-colors duration-200 group-hover:text-brand-blue',
            s.wordmark,
            wordmarkClassName
          )}
        >
          FORGE
        </span>
      )}
    </Link>
  );
}
