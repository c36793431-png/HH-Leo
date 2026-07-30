import Image from "next/image";
import Link from "next/link";

const SIZES = {
  nav: { mark: 22, gap: "gap-2", word: "text-sm", sub: "text-[10px]" },
  hero: { mark: 56, gap: "gap-4", word: "text-4xl sm:text-5xl", sub: "text-sm" },
} as const;

interface LogoProps {
  size?: keyof typeof SIZES;
  className?: string;
  href?: string | null;
}

export function Logo({ size = "nav", className = "", href = "/" }: LogoProps) {
  const s = SIZES[size];

  const mark = (
    <div className={`flex items-center ${s.gap} ${className}`}>
      <Image src="/logo.png" alt="Horizon HFT" width={s.mark} height={s.mark} priority />
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

  if (!href) return mark;

  return (
    <Link href={href} aria-label="Horizon HFT home">
      {mark}
    </Link>
  );
}
