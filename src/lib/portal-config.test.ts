/* Run: npx tsx --test src/lib/portal-config.test.ts
 *
 * The dashboard Education card's defaults (coxwell via marcus m60977, m61034): three across, and
 * every card is a real /education lesson, so a renamed or removed slug fails here instead of
 * quietly emptying a slot. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EDUCATION_PREVIEW } from "./portal-config";
import { getEducationLesson, lessonHref } from "./education";

test("Education card defaults: 3 cards; each is a real lesson, shown with its own title", () => {
  assert.equal(DEFAULT_EDUCATION_PREVIEW.length, 3, "three across on desktop");
  for (const d of DEFAULT_EDUCATION_PREVIEW) {
    assert.ok(d.href, `${d.title} has no link`);
    const slug = d.href.replace(/^\/education\//, "");
    const lesson = getEducationLesson(slug);
    assert.ok(lesson, `no lesson for ${d.href}`);
    assert.equal(lessonHref(lesson), d.href);
    assert.equal(d.title, lesson.title);
    assert.equal(d.summary, lesson.description);
  }
  assert.deepEqual(
    DEFAULT_EDUCATION_PREVIEW.map((d) => d.href),
    ["/education/getting-started", "/education/1-leg-latency-arb", "/education/broker-connections"],
  );
});
