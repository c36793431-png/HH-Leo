const SIZES = {
  nav: { mark: 22, gap: "gap-2", word: "text-sm", sub: "text-[10px]" },
  auth: { mark: 40, gap: "gap-3", word: "text-2xl", sub: "text-xs" },
  hero: { mark: 56, gap: "gap-4", word: "text-4xl sm:text-5xl", sub: "text-sm" },
} as const;

interface LogoProps {
  size?: keyof typeof SIZES;
  className?: string;
}

export function Logo({ size = "nav", className = "" }: LogoProps) {
  const s = SIZES[size];

  return (
    <div className={`flex items-center ${s.gap} ${className}`}>
      <svg
        width={s.mark}
        height={s.mark}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M3 22 L12 13 L18 19 L29 8" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21 8 H29 V16" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="3" y1="26" x2="29" y2="26" stroke="#3f3f46" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="flex flex-col leading-none">
        <span className={`font-semibold tracking-wide text-zinc-50 ${s.word}`}>
          HORIZON<span className="text-cyan-400"> HFT</span>
        </span>
        {size !== "nav" && (
          <span className={`mt-1 tracking-[0.2em] text-zinc-500 ${s.sub}`}>
            ARBITRAGE EXECUTION
          </span>
        )}
      </div>
    </div>
  );
}
