import { MAIN_SITE_URL } from "@/lib/main-site";
import type { FeedRegion } from "@/lib/feed-tier-catalogue";

/** The www blog's RSS feed, read server-side for the "From the blog" strip at the bottom of
 * /feeds/<region>/tiers (coxwell via marcus, m60947). No DB table: the feed is the source. */
export const BLOG_RSS_URL = `${MAIN_SITE_URL}/blog/rss.xml`;
export const BLOG_RSS_REVALIDATE_S = 3600;
const BLOG_RSS_TIMEOUT_MS = 3000;

/** The strip shows 3-4 cards, and hides itself below 2 (m60947). */
export const BLOG_STRIP_MAX = 4;
export const BLOG_STRIP_MIN = 2;

/** The www category that marks a feed post (FOC16, m60966). */
export const FEEDS_CATEGORY = "Feeds";

/** Words that tie a post to a region. A feed post on one of these is ordered first on that
 * region's page. Matched as whole words against the title and categories. */
const REGION_WORDS: Record<FeedRegion, readonly string[]> = {
  london: ["London"],
  ny: ["New York", "NY"],
  cme: ["Chicago", "CME"],
  tokyo: ["Tokyo"],
};

export type BlogPost = {
  title: string;
  link: string;
  /** ms since epoch, from pubDate. */
  publishedAt: number;
  excerpt: string;
  categories: string[];
  image: string | null;
};

/** What the strip renders: plain strings, so it crosses the server -> client boundary as is. */
export type BlogStripCard = {
  title: string;
  link: string;
  date: string;
  /** ISO 8601, for <time dateTime>. */
  dateTime: string;
  excerpt: string;
  image: string | null;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/** Text of an element: CDATA kept verbatim, everything else entity-decoded, tags stripped. */
function elementText(raw: string): string {
  const parts: string[] = [];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    parts.push(decodeEntities(raw.slice(last, m.index)), m[1]);
    last = m.index + m[0].length;
  }
  parts.push(decodeEntities(raw.slice(last)));
  return parts
    .join("")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function childTexts(item: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return [...item.matchAll(re)].map((m) => elementText(m[1]));
}

function attr(tagSource: string, name: string): string | null {
  const m = tagSource.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  return m ? decodeEntities(m[2] ?? m[3]) : null;
}

/** Only www's own pages and images are rendered; anything else in the feed is dropped. */
function onMainSite(url: string | null): url is string {
  if (!url) return false;
  try {
    return new URL(url).origin === MAIN_SITE_URL;
  } catch {
    return false;
  }
}

function itemImage(item: string): string | null {
  for (const m of item.matchAll(/<(media:content|media:thumbnail|enclosure)\b[^>]*>/g)) {
    const url = attr(m[0], "url");
    const type = attr(m[0], "type");
    const medium = attr(m[0], "medium");
    const isImage = m[1] === "media:thumbnail" || medium === "image" || (type ?? "").startsWith("image/");
    if (isImage && onMainSite(url)) return url;
  }
  return null;
}

/** RSS 2.0 items, newest first. An item without a title, a www link or a parseable date is
 * skipped rather than shown half-empty. */
export function parseBlogRss(xml: string): BlogPost[] {
  const posts: BlogPost[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)) {
    const item = m[1];
    const title = childTexts(item, "title")[0] ?? "";
    const link = childTexts(item, "link")[0] ?? "";
    const publishedAt = Date.parse(childTexts(item, "pubDate")[0] ?? "");
    if (!title || !onMainSite(link) || !Number.isFinite(publishedAt)) continue;
    posts.push({
      title,
      link,
      publishedAt,
      excerpt: childTexts(item, "description")[0] ?? "",
      categories: childTexts(item, "category"),
      image: itemImage(item),
    });
  }
  return posts.sort((a, b) => b.publishedAt - a.publishedAt);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isRegionFeedPost(post: BlogPost, region: FeedRegion): boolean {
  if (!post.categories.some((c) => c.toLowerCase() === FEEDS_CATEGORY.toLowerCase())) return false;
  const haystack = [post.title, ...post.categories].join(" \n ");
  return REGION_WORDS[region].some((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(haystack));
}

/** m60947's order: this region's feed posts first (newest first), then the latest of the rest.
 * Fewer than BLOG_STRIP_MIN posts = nothing, so the strip hides. */
export function pickBlogStripPosts(posts: BlogPost[], region: FeedRegion): BlogPost[] {
  const byDate = [...posts].sort((a, b) => b.publishedAt - a.publishedAt);
  const first = byDate.filter((p) => isRegionFeedPost(p, region));
  const rest = byDate.filter((p) => !isRegionFeedPost(p, region));
  const picked = [...first, ...rest].slice(0, BLOG_STRIP_MAX);
  return picked.length >= BLOG_STRIP_MIN ? picked : [];
}

/** "5 Oct 2026", in UTC: www stamps posts at 00:00 GMT, so a local zone would show the day before. */
export function formatBlogDate(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(ms),
  );
}

export function toBlogStripCards(posts: BlogPost[]): BlogStripCard[] {
  return posts.map((p) => ({
    title: p.title,
    link: p.link,
    date: formatBlogDate(p.publishedAt),
    dateTime: new Date(p.publishedAt).toISOString(),
    excerpt: p.excerpt,
    image: p.image,
  }));
}

/** The strip's cards for a region, or [] on any failure (network, status, parse), so the page
 * hides the strip silently (m60947). Cached for an hour through the fetch cache. */
export async function getBlogStripCards(region: FeedRegion): Promise<BlogStripCard[]> {
  try {
    const res = await fetch(BLOG_RSS_URL, {
      next: { revalidate: BLOG_RSS_REVALIDATE_S },
      signal: AbortSignal.timeout(BLOG_RSS_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return toBlogStripCards(pickBlogStripPosts(parseBlogRss(await res.text()), region));
  } catch {
    return [];
  }
}
