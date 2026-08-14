import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: { img: 'h-5 w-26 sm:w-28', wordmark: 'text-[10px]', gap: 'gap-2' },
  md: { img: 'h-7 w-36 sm:w-40', wordmark: 'text-sm', gap: 'gap-2.5' },
  lg: { img: 'h-10 w-52 sm:w-56', wordmark: 'text-base', gap: 'gap-3' },
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
 * Forge brand lockup: the Enlight Lab logo (`public/enlight-logo.png`,
 * 615×96 — DESIGN.md §5: rendered with `object-contain`, gentle `scale-[1.02]`
 * on hover) beside the FORGE wordmark. Inline SVG stays crisp at any size;
 * the whole lockup is a link.
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
      <span aria-hidden="true" className={cn('relative block shrink-0', s.img)}>
        <Image
          src="/enlight-logo.png"
          alt=""
          fill
          sizes="(min-width: 640px) 160px, 144px"
          className="object-contain transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
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
