import { pool } from "./db";
import { getEducationLesson, lessonHref } from "./education";

export interface PortalConfig {
  communityGroupUrl: string;
  telegramChannelUrl: string;
  telegramFreeGroupUrl: string;
  testingGroupUrl: string;
  pricingDisplay: string;
  educationPreview: { title: string; summary: string; href?: string }[];
}

/** A dashboard Education card for a real /education lesson: its own title, description and link. */
function lessonPreview(slug: string): PortalConfig["educationPreview"] {
  const lesson = getEducationLesson(slug);
  return lesson ? [{ title: lesson.title, summary: lesson.description, href: lessonHref(lesson) }] : [];
}

const DEFAULTS: PortalConfig = {
  communityGroupUrl: "https://t.me/horizonhft",
  telegramChannelUrl: "https://t.me/horizonhft",
  telegramFreeGroupUrl: "https://t.me/+2LSFHZbapbNlODhk",
  testingGroupUrl: "https://t.me/horizonhft",
  pricingDisplay: "Contact partner — full access to Horizon HFT",
  // Three real catalogue lessons (marcus m61034, on coxwell's m60977): titles, summaries and links come from education.ts.
  educationPreview: [
    ...lessonPreview("getting-started"),
    ...lessonPreview("1-leg-latency-arb"),
    ...lessonPreview("broker-connections"),
  ],
};

export const DEFAULT_EDUCATION_PREVIEW = DEFAULTS.educationPreview;

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
    telegramFreeGroupUrl: overrides.telegram_free_group_url as string ?? DEFAULTS.telegramFreeGroupUrl,
    testingGroupUrl: overrides.testing_group_url as string ?? DEFAULTS.testingGroupUrl,
    pricingDisplay: overrides.pricing_display as string ?? DEFAULTS.pricingDisplay,
    educationPreview:
      (overrides.education_preview as PortalConfig["educationPreview"]) ??
      DEFAULTS.educationPreview,
  };
}
