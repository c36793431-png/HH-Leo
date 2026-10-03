/* Run: npx tsx --test src/lib/education-public.test.ts
 *
 * The public Academy catalogue (marcus m59051): card fields only, lesson 11 under its public
 * copy, the do-not-publish guard firing, and the renamed slug's redirect landing on a real lesson. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDUCATION_LESSONS, getEducationLesson, renamedLessonSlug, type EducationLesson } from "./education";
import { publicEducationCatalogue } from "./education-public";

test("lesson 11 carries its public title and description", () => {
  const lesson = publicEducationCatalogue().lessons.find((l) => l.section === 11);
  assert.deepEqual(lesson, {
    slug: "timing-protection",
    title: "Timing & Protection",
    description: "Trade pacing, real vs. virtual stops, and auto-offset.",
    category: "advanced",
    minutes: 12,
    free: true,
    section: 11,
  });
});

test("every lesson is card fields only, with no intro or blocks", () => {
  const { lessons, categories } = publicEducationCatalogue();
  assert.equal(lessons.length, EDUCATION_LESSONS.length);
  for (const lesson of lessons) {
    assert.deepEqual(Object.keys(lesson).sort(), ["category", "description", "free", "minutes", "section", "slug", "title"]);
  }
  for (const category of categories) assert.deepEqual(Object.keys(category).sort(), ["key", "label", "subtitle"]);
});

test("a do-not-publish word anywhere in the payload throws", () => {
  const probe: EducationLesson = { ...EDUCATION_LESSONS[0], slug: "probe" };
  for (const title of ["STEALTH mode", "the Order Mixer"]) {
    EDUCATION_LESSONS.push({ ...probe, title });
    try {
      assert.throws(() => publicEducationCatalogue(), /do-not-publish/);
    } finally {
      EDUCATION_LESSONS.pop();
    }
  }
  assert.doesNotThrow(() => publicEducationCatalogue());
});

test("the old lesson-11 slug redirects to a lesson that exists, and is not itself a lesson", () => {
  const target = renamedLessonSlug("timing-protection-and-stealth");
  assert.equal(target, "timing-protection");
  assert.ok(getEducationLesson(target!));
  assert.equal(getEducationLesson("timing-protection-and-stealth"), undefined);
  assert.equal(renamedLessonSlug("timing-protection"), undefined);
});
