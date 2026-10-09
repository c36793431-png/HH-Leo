/* Run: npx tsx --test src/lib/education-signed-out.test.ts
 *
 * The signed-out lesson preview (coxwell via marcus, m62822): where each lesson is cut, that no
 * text from the hidden part is in what the page is given, lesson 11 under its public title, and
 * the do-not-publish guard firing. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDUCATION_LESSONS, type EducationLesson } from "./education";
import { signedOutLesson } from "./education-signed-out";

/** Every string a member sees that the visitor must not: the hidden blocks whole, and the items of
 * a one-block lesson's block. */
function hiddenText(lesson: EducationLesson, shownCount: number): string[] {
  const hidden = lesson.blocks.slice(shownCount).flatMap((b) => [b.heading, b.body, ...(b.items ?? [])]);
  if (lesson.blocks.length === 1) hidden.push(...(lesson.blocks[0].items ?? []));
  return hidden;
}

/** Blocks shown signed out, per lesson, written out rather than computed, so the leak test below
 * does not take the cut from the code under test. */
const EXPECTED_SHOWN: Record<string, number> = {
  "getting-started": 1,
  interface: 1,
  "broker-connections": 1,
  "fast-feed": 1,
  "1-leg-latency-arb": 1,
  "2-leg-lock-hedge-arb": 1,
  "trend-impulse": 1,
  obi: 1,
  "grid-arbitrage": 1,
  "risk-and-lot-sizing": 1,
  "timing-protection": 1,
  "tools-and-troubleshooting": 2,
};

test("the cut: first half of the blocks, rounded down, at least one", () => {
  const cuts = Object.fromEntries(
    EDUCATION_LESSONS.map((l) => {
      const v = signedOutLesson(l);
      return [l.slug, `${v.shownBlocks.length}/${l.blocks.length} hidden ${v.hiddenBlockCount}`];
    })
  );
  assert.deepEqual(cuts, {
    "getting-started": "1/3 hidden 2",
    interface: "1/2 hidden 1",
    "broker-connections": "1/3 hidden 2",
    "fast-feed": "1/2 hidden 1",
    "1-leg-latency-arb": "1/1 hidden 1",
    "2-leg-lock-hedge-arb": "1/2 hidden 1",
    "trend-impulse": "1/2 hidden 1",
    obi: "1/3 hidden 2",
    "grid-arbitrage": "1/3 hidden 2",
    "risk-and-lot-sizing": "1/2 hidden 1",
    "timing-protection": "1/2 hidden 1",
    "tools-and-troubleshooting": "2/4 hidden 2",
  });
});

test("no text from the hidden part is in any lesson's signed-out view", () => {
  assert.deepEqual(Object.keys(EXPECTED_SHOWN).sort(), EDUCATION_LESSONS.map((l) => l.slug).sort());
  for (const lesson of EDUCATION_LESSONS) {
    const text = JSON.stringify(signedOutLesson(lesson));
    const hidden = hiddenText(lesson, EXPECTED_SHOWN[lesson.slug]);
    assert.ok(hidden.length > 0, `${lesson.slug}: something is hidden`);
    for (const s of hidden) assert.ok(!text.includes(s), `${lesson.slug}: hidden text in the view: ${s}`);
  }
});

test("a one-block lesson shows its heading and sentence, not its list", () => {
  const view = signedOutLesson(EDUCATION_LESSONS.find((l) => l.slug === "1-leg-latency-arb")!);
  assert.deepEqual(view.shownBlocks, [
    {
      type: "setting",
      heading: "Core Parameters",
      body: "Tune these six parameters to shape entry sensitivity and risk:",
    },
  ]);
});

test("a lesson that is not free shows no blocks", () => {
  const view = signedOutLesson({ ...EDUCATION_LESSONS[0], free: false });
  assert.deepEqual(view.shownBlocks, []);
  assert.equal(view.hiddenBlockCount, EDUCATION_LESSONS[0].blocks.length);
});

test("lesson 11 shows its public title, and the Order Mixer block is in the hidden part", () => {
  const view = signedOutLesson(EDUCATION_LESSONS.find((l) => l.section === 11)!);
  assert.equal(view.title, "Timing & Protection");
  assert.deepEqual(view.shownBlocks.map((b) => b.heading), ["Timing & Protection"]);
});

test("no do-not-publish word in any lesson's signed-out view", () => {
  for (const lesson of EDUCATION_LESSONS) {
    const text = JSON.stringify(signedOutLesson(lesson)).toLowerCase();
    assert.ok(!text.includes("stealth") && !text.includes("order mixer"), lesson.slug);
  }
});

test("a do-not-publish word in the shown part throws", () => {
  const base = EDUCATION_LESSONS[0];
  for (const intro of ["STEALTH mode", "the Order Mixer"]) {
    assert.throws(() => signedOutLesson({ ...base, intro }), /do-not-publish/);
  }
  // In the hidden part it is fine: the visitor never gets it.
  const blocks = [base.blocks[0], { ...base.blocks[1], heading: "Order Mixer" }];
  assert.doesNotThrow(() => signedOutLesson({ ...base, blocks }));
});

test("only named fields: a field added to a lesson or block later is not passed through", () => {
  const base = EDUCATION_LESSONS[0];
  const probe = {
    ...base,
    secretNote: "x",
    blocks: base.blocks.map((b) => ({ ...b, secretNote: "x" })),
  } as EducationLesson;
  assert.ok(!JSON.stringify(signedOutLesson(probe)).includes("secretNote"));
});
