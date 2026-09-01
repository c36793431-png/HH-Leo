import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { EDUCATION_MANUAL_VERSION, getEducationLesson, type EducationBlock } from "@/lib/education";

const BLOCK_LABEL: Record<EducationBlock["type"], string> = {
  info: "Info",
  setting: "Setting",
  warning: "Warning",
  blocked: "Requirement",
};

/** Pulls specific blocks (by heading, in the given order) out of a shipped education lesson,
 * so this page stays in lockstep with the Horizon HFT User Tutorial instead of re-typing it. */
function pickBlocks(slug: string, headings: string[]): EducationBlock[] {
  const lesson = getEducationLesson(slug);
  if (!lesson) return [];
  return headings
    .map((heading) => lesson.blocks.find((b) => b.heading === heading))
    .filter((b): b is EducationBlock => Boolean(b));
}

function BlockList({ blocks }: { blocks: EducationBlock[] }) {
  return (
    <div className="lesson-blocks">
      {blocks.map((block) => (
        <div key={block.heading} className={`lesson-block ${block.type}`}>
          <div className="lb-head">
            <span className="lb-tag">{BLOCK_LABEL[block.type]}</span>
            <h3>{block.heading}</h3>
          </div>
          <p>{block.body}</p>
          {block.items && block.items.length > 0 && (
            <ul>
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

const PLATFORMS_BLOCK: EducationBlock = {
  type: "info",
  heading: "Platforms",
  body: "The terminal runs against four platforms:",
  items: ["MT4", "MT5", "Rithmic", "NinjaTrader 8"],
};

const STRATEGIES: Array<{ slug: string; title: string; headings: string[] }> = [
  { slug: "1-leg-latency-arb", title: "1 Leg — Latency Arbitrage", headings: ["Core Parameters"] },
  { slug: "2-leg-lock-hedge-arb", title: "2 Leg Lock — Hedge Arbitrage", headings: ["Core Parameters", "Broker Requirement"] },
  { slug: "trend-impulse", title: "Trend Impulse", headings: ["Fast Feed Impulse Detection", "Core Parameters"] },
  { slug: "obi", title: "OBI — Order Book Imbalance", headings: ["CME L2 Depth", "Core Parameters", "Feed Requirement"] },
  { slug: "grid-arbitrage", title: "Grid Arbitrage", headings: ["Entry Logic", "Progressive Volume", "Basket Exits & Risk"] },
];

export default async function WhatsIncludedPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);

  const [activeLicenses, config] = await Promise.all([
    getActiveLicenseDetailsForUser(session.user.id).catch(() => []),
    getPortalConfig(),
  ]);
  const isAdmin = isAdminUser(session.user);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  const connectivityBlocks = pickBlocks("broker-connections", [
    "MT5 Manager API (Recommended)",
    "MT4 Support",
    "Rithmic Caveats",
  ]).concat(pickBlocks("fast-feed", ["What It Is", "Why the Data Advantage Matters"]));

  const riskBlocks = pickBlocks("risk-and-lot-sizing", ["FixedLot vs. Risk% (Auto-Lot)", "TrendFilter (EMA)"]).concat(
    pickBlocks("timing-protection-and-stealth", ["Timing & Protection", "Order Mixer"]),
  );

  const toolsBlocks = pickBlocks("tools-and-troubleshooting", ["Tick Recorder"]).concat(
    pickBlocks("interface", ["Tab Layout", "Multi-Tab Workspaces"]),
  );

  const licensingBlocks = pickBlocks("getting-started", ["20-Character License Key", "Hardware Lock"]);

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <div className="edu-hero">
        <div className="eyebrow">What&apos;s Included</div>
        <h2>The Horizon HFT terminal</h2>
        <p>
          Platforms, connectivity, the five built-in strategies, risk &amp; stealth controls, and the licensing
          model — everything the terminal ships with, sourced from the Horizon HFT User Tutorial{" "}
          {EDUCATION_MANUAL_VERSION}.
        </p>
      </div>

      <div className="card full">
        <div className="chead">
          <span className="ic">▥</span>
          <h3>Platforms &amp; Connectivity</h3>
        </div>
        <BlockList blocks={[PLATFORMS_BLOCK, ...connectivityBlocks]} />
      </div>

      <div className="card full">
        <div className="chead">
          <span className="ic">◇</span>
          <h3>Strategies</h3>
          <span className="cap">5 built in</span>
        </div>
        <div className="rows" style={{ gap: 26 }}>
          {STRATEGIES.map((s) => (
            <div key={s.slug}>
              <h3 style={{ fontFamily: "var(--hz-disp)", fontWeight: 700, fontSize: 17, marginBottom: 10 }}>
                {s.title}
              </h3>
              <BlockList blocks={pickBlocks(s.slug, s.headings)} />
            </div>
          ))}
        </div>
      </div>

      <div className="card full">
        <div className="chead">
          <span className="ic">◱</span>
          <h3>Risk &amp; Stealth</h3>
        </div>
        <BlockList blocks={riskBlocks} />
      </div>

      <div className="card full">
        <div className="chead">
          <span className="ic">≡</span>
          <h3>Tools &amp; Interface</h3>
        </div>
        <BlockList blocks={toolsBlocks} />
      </div>

      <div className="card full">
        <div className="chead">
          <span className="ic">⬡</span>
          <h3>Licensing</h3>
        </div>
        <BlockList blocks={licensingBlocks} />
      </div>

      <div className="card full">
        <div className="chead">
          <span className="ic">⚡</span>
          <h3>Ready to go live?</h3>
        </div>
        <p style={{ fontSize: 13, color: "var(--hz-ink-2)", lineHeight: 1.6, marginBottom: 16 }}>
          Licenses are issued manually · typically &lt; 1h. Reach out on Telegram and we&apos;ll walk you through
          activation.
        </p>
        <a className="btn primary" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
          Reach out on Telegram to get a license
        </a>
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
