/* Run: npx tsx --test src/lib/education-signed-out.test.ts
 *
 * The signed-out lesson preview (coxwell via marcus, m62822): where each lesson is cut, that no
 * text from the hidden part is in what the page is given, lesson 11 under its public title, and
 * the do-not-publish guard firing. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDUCATION_LESSONS, type EducationLesson } from "./education";
import { signedOutLesson } from "./education-signed-out";
import { strategyCardImage } from "./basket-catalogue";
import { publicEducationCatalogue } from "./education-public";
import { withCardImages } from "./education-cards";

// Written out, not imported: the test should fail if someone shortens the code's list.
const BANNED = ["stealth", "order mixer", "disguis", "footprint"];

/** Every string a member sees that the visitor must not: the hidden blocks whole, and the items of
 * a one-block lesson's block. */
function hiddenText(lesson: EducationLesson, shownCount: number): string[] {
  const shownText = JSON.stringify(lesson.blocks.slice(0, lesson.blocks.length === 1 ? 0 : shownCount));
  const hidden = lesson.blocks
    .slice(shownCount)
    .flatMap((b) => [b.heading, b.body, ...(b.items ?? []), ...(b.qa ?? []).flatMap((x) => [x.q, x.a]), ...(b.links ?? []).map((x) => x.label)])
    .filter((t) => t !== "" && t !== lesson.title) // the title is shown; a block heading may repeat it (the final check)
    // A takeaway may repeat a sentence of a shown block word for word: shown either way, not a leak.
    .filter((t) => !shownText.includes(t));
  if (lesson.blocks.length === 1) {
    const [only] = lesson.blocks;
    hidden.push(...(only.items ?? []), ...(only.qa ?? []).flatMap((x) => [x.q, x.a]), ...(only.links ?? []).map((x) => x.label));
  }
  // A lesson with a public intro keeps its member intro for members.
  if (lesson.publicIntro) hidden.push(lesson.intro);
  if (lesson.closing) hidden.push(lesson.closing);
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
  obi: 2, // 8 blocks since the live-guide sync (marcus m73349)
  "grid-arbitrage": 1,
  "risk-and-lot-sizing": 1,
  "timing-protection": 1,
  "tools-and-troubleshooting": 1,
  "agentic-trading-what-it-is": 2,
  "agentic-trading-where-it-is-today": 3,
  "agentic-trading-what-can-go-wrong": 2,
  "agentic-trading-safe-structure": 2,
  "agentic-trading-testing": 2,
  "agentic-trading-rules": 2,
  "agentic-trading-horizon-ai": 2,
  "agentic-trading-final-check": 1,
};

test("the cut: first quarter of the blocks, rounded up, so at least one full block (m67291)", () => {
  const cuts = Object.fromEntries(
    EDUCATION_LESSONS.map((l) => {
      const v = signedOutLesson(l);
      return [l.slug, `${v.shownBlocks.length}/${l.blocks.length} hidden ${v.hiddenBlockCount}`];
    })
  );
  assert.deepEqual(cuts, {
    "getting-started": "1/3 hidden 2",
    interface: "1/2 hidden 1",
    "broker-connections": "1/4 hidden 3",
    "fast-feed": "1/2 hidden 1",
    "1-leg-latency-arb": "1/1 hidden 1",
    "2-leg-lock-hedge-arb": "1/3 hidden 2",
    "trend-impulse": "1/2 hidden 1",
    obi: "2/8 hidden 6", // synced to the live OBI guide (marcus m73349): 8 blocks, first quarter = 2
    "grid-arbitrage": "1/3 hidden 2",
    "risk-and-lot-sizing": "1/2 hidden 1",
    "timing-protection": "1/2 hidden 1",
    "tools-and-troubleshooting": "1/4 hidden 3",
    "agentic-trading-what-it-is": "2/6 hidden 4",
    "agentic-trading-where-it-is-today": "3/9 hidden 6",
    "agentic-trading-what-can-go-wrong": "2/6 hidden 4",
    "agentic-trading-safe-structure": "2/7 hidden 5",
    "agentic-trading-testing": "2/6 hidden 4",
    "agentic-trading-rules": "2/6 hidden 4",
    "agentic-trading-horizon-ai": "2/5 hidden 3",
    "agentic-trading-final-check": "1/1 hidden 1",
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

test("lesson 11 shows its public title and intro, and the Order Mixer block is in the hidden part", () => {
  const view = signedOutLesson(EDUCATION_LESSONS.find((l) => l.section === 11)!);
  assert.equal(view.title, "Timing & Protection");
  assert.equal(view.intro, "How Horizon times entries and protects open positions.");
  assert.deepEqual(view.shownBlocks.map((b) => b.heading), ["Timing & Protection"]);
});

test("no do-not-publish word in any lesson's signed-out view", () => {
  for (const lesson of EDUCATION_LESSONS) {
    const text = JSON.stringify(signedOutLesson(lesson)).toLowerCase();
    for (const word of BANNED) assert.ok(!text.includes(word), `${lesson.slug}: ${word}`);
  }
});

test("each strategy lesson carries its marketplace card diagram, and only those", () => {
  const withDiagram = Object.fromEntries(
    EDUCATION_LESSONS.filter((l) => l.strategy).map((l) => [l.slug, strategyCardImage(signedOutLesson(l).strategy!)?.src])
  );
  assert.deepEqual(withDiagram, {
    "1-leg-latency-arb": "/marketplace/strategies/1-leg.png",
    "2-leg-lock-hedge-arb": "/marketplace/strategies/2-leg-lock.png",
    "trend-impulse": "/marketplace/strategies/trend-impulse.png",
    obi: "/marketplace/strategies/obi.png",
    "grid-arbitrage": "/marketplace/strategies/grid-arbitrage.png",
  });
});

test("index cards: the 5 strategy lessons show their diagram, signed out and in; the rest keep the glyph (m62977)", () => {
  const thumbs = (cards: { slug: string; image: { src: string } | null }[]) =>
    Object.fromEntries(cards.filter((c) => c.image).map((c) => [c.slug, c.image!.src]));
  const expected = {
    "1-leg-latency-arb": "/marketplace/strategies/1-leg.png",
    "2-leg-lock-hedge-arb": "/marketplace/strategies/2-leg-lock.png",
    "trend-impulse": "/marketplace/strategies/trend-impulse.png",
    obi: "/marketplace/strategies/obi.png",
    "grid-arbitrage": "/marketplace/strategies/grid-arbitrage.png",
  };
  assert.deepEqual(thumbs(withCardImages(publicEducationCatalogue().lessons)), expected);
  assert.deepEqual(thumbs(withCardImages(EDUCATION_LESSONS)), expected);
  // Signed out, a card is still the catalogue's fields plus the image: no intro, no blocks.
  const signedOut = withCardImages(publicEducationCatalogue().lessons);
  assert.ok(signedOut.every((c) => !("intro" in c) && !("blocks" in c)));
});

test("a do-not-publish word in the shown part throws", () => {
  const base = EDUCATION_LESSONS[0];
  for (const intro of ["STEALTH mode", "the Order Mixer", "it disguises orders", "a smaller footprint"]) {
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
