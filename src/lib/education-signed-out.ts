import { EDUCATION_LESSONS, type EducationBlock, type EducationLesson } from "./education";
import { DO_NOT_PUBLISH } from "./education-public";

/** A lesson as a signed-out visitor's page is built from it (coxwell via marcus, m62822): the
 * header, the intro and the first part of the lesson, plus how many placeholder blocks to draw
 * under the blur. The rest of the lesson is not in this object, so the page cannot render it:
 * view-source and reader mode only find the placeholder.
 *
 * A public surface, so lesson 11 shows its public title and intro and the do-not-publish words are checked
 * here as in the public catalogue (marcus, m59051/m59062). Fields are copied by name, so a field
 * added to EducationLesson or EducationBlock later stays private until it is added here. */
export type SignedOutLesson = Pick<EducationLesson, "slug" | "title" | "category" | "section" | "intro" | "strategy" | "course"> & {
  shownBlocks: EducationBlock[];
  /** Blocks the visitor doesn't see. Drawn as that many placeholder blocks; no text from them. */
  hiddenBlockCount: number;
};

/** The cut: the first quarter of the blocks, rounded up, so at least one full block (coxwell 'maybe 25%' via
 * marcus m67291; was the first half). The agentic trading course is cut the same way (it showed no blocks before).
 * A one-block lesson (1 Leg, the course's final check) shows its heading and sentence and keeps the list, the
 * questions and the links under it for members. A lesson that is not free shows no blocks, as a signed-in member
 * without the plan sees it (LessonDetail's locked view). Shown blocks carry type, tag, heading, body and items only. */
function cut(lesson: EducationLesson): { shown: EducationBlock[]; hidden: number } {
  const n = lesson.blocks.length;
  if (!lesson.free || n === 0) return { shown: [], hidden: Math.max(n, 1) };
  if (n === 1) {
    const [{ type, tag, heading, body }] = lesson.blocks;
    return { shown: [{ type, ...(tag ? { tag } : {}), heading, body }], hidden: 1 };
  }
  const k = Math.ceil(n / 4);
  return { shown: lesson.blocks.slice(0, k).map(({ type, tag, heading, body, items }) => ({ type, ...(tag ? { tag } : {}), heading, body, items })), hidden: n - k };
}

/** Throws when a do-not-publish word is in what a signed-out visitor would get. */
export function signedOutLesson(lesson: EducationLesson): SignedOutLesson {
  const { shown, hidden } = cut(lesson);
  const view: SignedOutLesson = {
    slug: lesson.slug,
    title: lesson.publicTitle ?? lesson.title,
    category: lesson.category,
    section: lesson.section,
    intro: lesson.publicIntro ?? lesson.intro,
    strategy: lesson.strategy,
    course: lesson.course,
    shownBlocks: shown,
    hiddenBlockCount: hidden,
  };
  const text = JSON.stringify(view).toLowerCase();
  const leaked = DO_NOT_PUBLISH.filter((word) => text.includes(word));
  if (leaked.length > 0) {
    throw new Error(`Signed-out lesson ${lesson.slug} contains do-not-publish words: ${leaked.join(", ")}`);
  }
  return view;
}

// Every lesson, once, when the module loads: a do-not-publish word in any lesson's public part
// fails the pages that import this, not only the one lesson's page when someone opens it.
for (const lesson of EDUCATION_LESSONS) signedOutLesson(lesson);
