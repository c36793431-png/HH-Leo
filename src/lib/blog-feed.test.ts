/* Run: npx tsx --test src/lib/blog-feed.test.ts
 *
 * The tiers page's blog strip (m60947): parse www's RSS, put this region's feed posts first, fill
 * with the latest, hide below 2. The fixture items copy the live feed's shape at 18:3xZ 10-05. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOG_STRIP_MAX,
  formatBlogDate,
  getBlogStripCards,
  isRegionFeedPost,
  parseBlogRss,
  pickBlogStripPosts,
  toBlogStripCards,
  type BlogPost,
} from "./blog-feed";

function item(slug: string, date: string, cats: string[], extra = "") {
  return `<item>
      <title>${slug} title</title>
      <link>https://www.horizonhft.com/blog/${slug}</link>
      <guid isPermaLink="true">https://www.horizonhft.com/blog/${slug}</guid>
      <pubDate>${date}</pubDate>
      ${cats.map((c) => `<category>${c}</category>`).join("\n      ")}
      <description>About ${slug}.</description>
      <media:content url="https://www.horizonhft.com/og/blog-${slug}.png" medium="image" type="image/png" width="1200" height="630" />
      ${extra}
    </item>`;
}

function feed(...items: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Horizon HFT blog</title>
    <link>https://www.horizonhft.com/blog</link>
    ${items.join("\n    ")}
  </channel>
</rss>`;
}

const LIVE_SHAPE = feed(
  item("horizon-v2-0-7-release-notes", "Mon, 05 Oct 2026 00:00:00 GMT", ["Release notes", "Software"]),
  item("how-we-compare-our-london-feeds", "Sun, 04 Oct 2026 00:00:00 GMT", ["Research", "Feeds"]),
  item("horizon-v2-0-5-release-notes", "Thu, 13 Aug 2026 00:00:00 GMT", ["Release notes", "Software"]),
  item("horizon-v2-0-4-release-notes", "Wed, 12 Aug 2026 00:00:00 GMT", ["Release notes", "Software"]),
  item("horizon-v2-0-3-release-notes", "Tue, 11 Aug 2026 00:00:00 GMT", ["Release notes", "Software"]),
);

const slugs = (posts: BlogPost[]) => posts.map((p) => p.link.replace("https://www.horizonhft.com/blog/", ""));

test("parses the live feed's item shape", () => {
  const posts = parseBlogRss(LIVE_SHAPE);
  assert.equal(posts.length, 5);
  assert.deepEqual(posts[1], {
    title: "how-we-compare-our-london-feeds title",
    link: "https://www.horizonhft.com/blog/how-we-compare-our-london-feeds",
    publishedAt: Date.UTC(2026, 9, 4),
    excerpt: "About how-we-compare-our-london-feeds.",
    categories: ["Research", "Feeds"],
    image: "https://www.horizonhft.com/og/blog-how-we-compare-our-london-feeds.png",
  });
});

test("London: the London feed post leads, then the latest of the rest", () => {
  const picked = pickBlogStripPosts(parseBlogRss(LIVE_SHAPE), "london");
  assert.deepEqual(slugs(picked), [
    "how-we-compare-our-london-feeds",
    "horizon-v2-0-7-release-notes",
    "horizon-v2-0-5-release-notes",
    "horizon-v2-0-4-release-notes",
  ]);
});

test("NY: no NY feed post, so plain newest first (the London feed post is not promoted)", () => {
  const picked = pickBlogStripPosts(parseBlogRss(LIVE_SHAPE), "ny");
  assert.deepEqual(slugs(picked), [
    "horizon-v2-0-7-release-notes",
    "how-we-compare-our-london-feeds",
    "horizon-v2-0-5-release-notes",
    "horizon-v2-0-4-release-notes",
  ]);
});

test("region match needs the Feeds category, and matches whole words in title or category", () => {
  const post = (title: string, categories: string[]): BlogPost => ({
    title,
    link: "https://www.horizonhft.com/blog/x",
    publishedAt: 0,
    excerpt: "",
    categories,
    image: null,
  });
  assert.equal(isRegionFeedPost(post("London latency notes", ["Research"]), "london"), false);
  assert.equal(isRegionFeedPost(post("London latency notes", ["Feeds"]), "london"), true);
  assert.equal(isRegionFeedPost(post("Feed notes", ["feeds", "New York"]), "ny"), true);
  assert.equal(isRegionFeedPost(post("Our CME routes", ["Feeds"]), "cme"), true);
  assert.equal(isRegionFeedPost(post("Sunny days", ["Feeds"]), "ny"), false);
  assert.equal(isRegionFeedPost(post("Londoners", ["Feeds"]), "london"), false);
});

test("caps at 4 and hides below 2", () => {
  assert.equal(pickBlogStripPosts(parseBlogRss(LIVE_SHAPE), "tokyo").length, BLOG_STRIP_MAX);
  const one = feed(item("only", "Mon, 05 Oct 2026 00:00:00 GMT", ["Software"]));
  assert.deepEqual(pickBlogStripPosts(parseBlogRss(one), "london"), []);
  assert.deepEqual(pickBlogStripPosts(parseBlogRss("<html>502 Bad Gateway</html>"), "london"), []);
  assert.deepEqual(pickBlogStripPosts([], "london"), []);
});

test("skips items with an off-site link, no title or a bad date; drops an off-site image", () => {
  const xml = feed(
    item("good", "Mon, 05 Oct 2026 00:00:00 GMT", ["Software"]),
    item("bad-date", "not a date", ["Software"]),
    `<item><title>Elsewhere</title><link>https://evil.example/blog/x</link><pubDate>Mon, 05 Oct 2026 00:00:00 GMT</pubDate></item>`,
    `<item><title></title><link>https://www.horizonhft.com/blog/untitled</link><pubDate>Mon, 05 Oct 2026 00:00:00 GMT</pubDate></item>`,
    `<item><title>Off-site cover</title><link>https://www.horizonhft.com/blog/cover</link><pubDate>Sun, 04 Oct 2026 00:00:00 GMT</pubDate>
      <media:content url="https://cdn.example/x.png" medium="image" /></item>`,
  );
  const posts = parseBlogRss(xml);
  assert.deepEqual(slugs(posts), ["good", "cover"]);
  assert.equal(posts[1].image, null);
});

test("decodes entities and CDATA, strips tags from the excerpt", () => {
  const xml = feed(`<item>
      <title>Risk &amp; sizing &#8212; &quot;2.0.7&quot;</title>
      <link>https://www.horizonhft.com/blog/risk</link>
      <pubDate>Mon, 05 Oct 2026 00:00:00 GMT</pubDate>
      <description><![CDATA[<p>Size from your <b>broker's</b> data &amp; more.</p>]]></description>
    </item>`);
  const [p] = parseBlogRss(xml);
  assert.equal(p.title, 'Risk & sizing — "2.0.7"');
  assert.equal(p.excerpt, "Size from your broker's data &amp; more.");
  assert.equal(p.image, null);
});

test("getBlogStripCards: a throw, a non-2xx or a non-RSS body is [] (strip hidden); a good feed is cards", async (t) => {
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  const respond = (fn: () => Promise<Response>) => {
    globalThis.fetch = (() => fn()) as typeof fetch;
  };
  respond(() => Promise.reject(new TypeError("fetch failed")));
  assert.deepEqual(await getBlogStripCards("london"), []);
  respond(async () => new Response(LIVE_SHAPE, { status: 500 }));
  assert.deepEqual(await getBlogStripCards("london"), []);
  respond(async () => new Response("<html>maintenance</html>", { status: 200 }));
  assert.deepEqual(await getBlogStripCards("london"), []);
  respond(async () => new Response(LIVE_SHAPE, { status: 200 }));
  const cards = await getBlogStripCards("london");
  assert.equal(cards.length, BLOG_STRIP_MAX);
  assert.equal(cards[0].title, "how-we-compare-our-london-feeds title");
});

test("dates render in UTC, so a 00:00 GMT post keeps its day", () => {
  assert.equal(formatBlogDate(Date.UTC(2026, 9, 5)), "5 Oct 2026");
  const [card] = toBlogStripCards(parseBlogRss(LIVE_SHAPE));
  assert.equal(card.date, "5 Oct 2026");
  assert.equal(card.dateTime, "2026-10-05T00:00:00.000Z");
});
