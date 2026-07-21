import { pool } from "./db";

export interface PortalConfig {
  communityGroupUrl: string;
  telegramChannelUrl: string;
  testingGroupUrl: string;
  pricingDisplay: string;
  educationPreview: { title: string; summary: string }[];
}

const DEFAULTS: PortalConfig = {
  communityGroupUrl: "https://t.me/horizonhft",
  telegramChannelUrl: "https://t.me/horizonhft",
  testingGroupUrl: "https://t.me/horizonhft",
  pricingDisplay: "$100/mo — full access to Horizon HFT",
  educationPreview: [
    {
      title: "Getting started with arbitrage execution",
      summary: "How Horizon's 4 core strategies identify and act on cross-venue spreads.",
    },
    {
      title: "Connecting MT4/MT5/NinjaTrader 8",
      summary: "Bridge setup basics for each supported platform.",
    },
  ],
};

/** Reads admin-editable overrides from portal_config; falls back to MVP defaults for unseeded keys/tables. */
export async function getPortalConfig(): Promise<PortalConfig> {
  let rows: { key: string; value: unknown }[] = [];
  try {
    const result = await pool.query<{ key: string; value: unknown }>(
      "select key, value from portal_config"
    );
    rows = result.rows;
  } catch (err) {
    console.error("getPortalConfig: falling back to defaults", err);
  }
  const overrides = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return {
    communityGroupUrl: overrides.community_group_url as string ?? DEFAULTS.communityGroupUrl,
    telegramChannelUrl: overrides.telegram_channel_url as string ?? DEFAULTS.telegramChannelUrl,
    testingGroupUrl: overrides.testing_group_url as string ?? DEFAULTS.testingGroupUrl,
    pricingDisplay: overrides.pricing_display as string ?? DEFAULTS.pricingDisplay,
    educationPreview:
      (overrides.education_preview as PortalConfig["educationPreview"]) ??
      DEFAULTS.educationPreview,
  };
}
