/* Run: npx tsx --test src/lib/portal-config.test.ts
 *
 * The dashboard Education card's defaults (coxwell via marcus m60977): three across, and every
 * linked card is a real /education lesson, so a renamed or removed slug fails here instead of
 * quietly emptying the third slot again. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EDUCATION_PREVIEW } from "./portal-config";
import { getEducationLesson, lessonHref } from "./education";

test("Education card defaults: 3 cards; each href is a real lesson, shown with its own title", () => {
  assert.equal(DEFAULT_EDUCATION_PREVIEW.length, 3, "three across on desktop");
  const linked = DEFAULT_EDUCATION_PREVIEW.filter((d) => d.href);
  assert.ok(linked.length >= 1);
  for (const d of linked) {
    const slug = d.href!.replace(/^\/education\//, "");
    const lesson = getEducationLesson(slug);
    assert.ok(lesson, `no lesson for ${d.href}`);
    assert.equal(lessonHref(lesson!), d.href);
    assert.equal(d.title, lesson!.title);
    assert.equal(d.summary, lesson!.description);
  }
  assert.equal(DEFAULT_EDUCATION_PREVIEW[2].href, "/education/getting-started");
});
