/* Run: npx tsx --test src/lib/education-course.test.ts
 *
 * The agentic trading course's 'Next lesson' chain (marcus m67166): 1 -> 2 -> ... -> 7 -> Final check, then nothing,
 * and no manual lesson gets a link. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDUCATION_LESSONS, nextCourseLesson } from "./education";

test("each course lesson links to the next, lesson 7 to the final check, the final check to nothing", () => {
  const chain = Object.fromEntries(
    EDUCATION_LESSONS.filter((l) => l.course).map((l) => [l.slug, nextCourseLesson(l)?.slug ?? null])
  );
  assert.deepEqual(chain, {
    "agentic-trading-what-it-is": "agentic-trading-where-it-is-today",
    "agentic-trading-where-it-is-today": "agentic-trading-what-can-go-wrong",
    "agentic-trading-what-can-go-wrong": "agentic-trading-safe-structure",
    "agentic-trading-safe-structure": "agentic-trading-testing",
    "agentic-trading-testing": "agentic-trading-rules",
    "agentic-trading-rules": "agentic-trading-horizon-ai",
    "agentic-trading-horizon-ai": "agentic-trading-final-check",
    "agentic-trading-final-check": null,
  });
});

test("a manual lesson has no next course lesson", () => {
  for (const lesson of EDUCATION_LESSONS.filter((l) => !l.course)) assert.equal(nextCourseLesson(lesson), undefined);
});
