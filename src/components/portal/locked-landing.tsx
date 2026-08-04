/** Shared locked-landing shown to non-license users on the paid-tier sidebar shell pages
 * (Setfiles, Brokers, Prop Firm, Advanced Education) — same "empty" pattern as My Setup. */
export function LockedLanding({
  feature,
  tease,
  telegramChannelUrl,
}: {
  feature: string;
  tease: string;
  telegramChannelUrl: string;
}) {
  return (
    <div className="empty">
      <div className="eic">🔒</div>
      <b>{feature} is available with a Horizon HFT license.</b>
      <p>{tease}</p>
      <a
        className="btn primary sm"
        href={telegramChannelUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ marginTop: 12 }}
      >
        ⚡ Upgrade to Paid
      </a>
    </div>
  );
}
