/** Small inline SVG region flags for /account/servers (marcus, overnight-builds-2026-08-30).
 * Emoji regional-indicator flags don't render on Windows (no flag-emoji font -- Chrome/Edge
 * fall back to the literal two-letter code, e.g. "GB"). These are hand-drawn, rect-based
 * approximations at icon scale, not pixel-accurate flags. Decorative: each is rendered next
 * to the region name as plain text, so they're marked aria-hidden rather than labelled. */

interface FlagProps {
  className?: string;
}

const STRIPE_H = 15 / 13;

export function UsFlag({ className }: FlagProps) {
  return (
    <svg viewBox="0 0 20 15" className={className} aria-hidden="true">
      <rect width="20" height="15" fill="#fff" />
      {Array.from({ length: 13 }).map((_, i) =>
        i % 2 === 0 ? <rect key={i} x="0" y={i * STRIPE_H} width="20" height={STRIPE_H} fill="#b22234" /> : null
      )}
      <rect x="0" y="0" width="8" height={7 * STRIPE_H} fill="#3c3b6e" />
    </svg>
  );
}

export function GbFlag({ className }: FlagProps) {
  return (
    <svg viewBox="0 0 20 15" className={className} aria-hidden="true">
      <rect width="20" height="15" fill="#00247d" />
      <path d="M0,0 L20,15 M20,0 L0,15" stroke="#fff" strokeWidth="2.4" />
      <path d="M0,0 L20,15 M20,0 L0,15" stroke="#cf142b" strokeWidth="1.4" />
      <path d="M10,0 V15 M0,7.5 H20" stroke="#fff" strokeWidth="4" />
      <path d="M10,0 V15 M0,7.5 H20" stroke="#cf142b" strokeWidth="2.4" />
    </svg>
  );
}

export function JpFlag({ className }: FlagProps) {
  return (
    <svg viewBox="0 0 20 15" className={className} aria-hidden="true">
      <rect width="20" height="15" fill="#fff" />
      <circle cx="10" cy="7.5" r="4.2" fill="#bc002d" />
    </svg>
  );
}
