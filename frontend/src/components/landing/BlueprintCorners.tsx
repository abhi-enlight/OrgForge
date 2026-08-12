/**
 * BlueprintCorners: blueprint-sheet registration marks (+) at the four corners
 * of its parent. Purely decorative texture that fills the blank corners of
 * light sections — aria-hidden, pointer-events-none, no layout impact.
 * Parent must be `relative`.
 */
export function BlueprintCorners() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-2 sm:inset-4"
    >
      {/* top corners */}
      <span className="absolute left-0 top-0 h-2.5 w-2.5 border-l border-t border-blueprint-line-strong/60" />
      <span className="absolute right-0 top-0 h-2.5 w-2.5 border-r border-t border-blueprint-line-strong/60" />
      {/* bottom corners */}
      <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-blueprint-line-strong/60" />
      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-blueprint-line-strong/60" />
    </div>
  );
}
