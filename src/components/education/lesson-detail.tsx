import {
  EDUCATION_CATEGORIES,
  EDUCATION_MANUAL_TOTAL_SECTIONS,
  EDUCATION_MANUAL_VERSION,
  type EducationBlock,
  type EducationLesson,
} from "@/lib/education";
import type { SignedOutLesson } from "@/lib/education-signed-out";
import { strategyCardImage } from "@/lib/basket-catalogue";

const BLOCK_LABEL: Record<EducationBlock["type"], string> = {
  info: "Info",
  setting: "Setting",
  warning: "Warning",
  blocked: "Requirement",
};

function LessonHeader({ lesson }: { lesson: Pick<EducationLesson, "title" | "section" | "category"> }) {
  const category = EDUCATION_CATEGORIES.find((c) => c.key === lesson.category);
  return (
    <div className="lesson-head">
      <a className="lesson-back" href="/education">
        ← Back to Horizon Academy
      </a>
      <div className="lesson-head-row">
        <div className="lesson-badge">{lesson.section}</div>
        <div className="lesson-head-txt">
          <h1>{lesson.title}</h1>
          <span>
            Horizon HFT User Tutorial {EDUCATION_MANUAL_VERSION} · Section {lesson.section} of{" "}
            {EDUCATION_MANUAL_TOTAL_SECTIONS} · {category?.label}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The strategy's marketplace card diagram, under the title (coxwell via marcus, m62840): the same
 * file the /marketplace card shows, drawn larger. Decorative, as on the card: the lesson's text
 * carries the meaning. */
function LessonDiagram({ lesson }: { lesson: Pick<EducationLesson, "strategy"> }) {
  const image = lesson.strategy ? strategyCardImage(lesson.strategy) : null;
  if (!image) return null;
  return (
    <div className="lesson-diagram" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.src2x} srcSet={`${image.src} 316w, ${image.src2x} 632w`} sizes="(max-width: 700px) 100vw, 632px" alt="" width={632} height={240} />
    </div>
  );
}

function LessonBlock({ block }: { block: EducationBlock }) {
  return (
    <div className={`lesson-block ${block.type}`}>
      <div className="lb-head">
        <span className="lb-tag">{BLOCK_LABEL[block.type]}</span>
        <h3>{block.heading}</h3>
      </div>
      <p>{block.body}</p>
      {block.items && block.items.length > 0 && (
        <ul>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LessonDetail({ lesson, isPaidTier }: { lesson: EducationLesson; isPaidTier: boolean }) {
  const locked = !lesson.free && !isPaidTier;

  if (locked) {
    return (
      <div className="lesson-detail">
        <LessonHeader lesson={lesson} />
        <p className="lesson-intro">{lesson.intro}</p>
        <div className="lesson-locked-cta">
          <span className="glyph">🔒</span>
          <div>
            <b>This lesson is part of your paid plan</b>
            <span>Upgrade to unlock the full walkthrough, parameters, and settings for {lesson.title}.</span>
          </div>
          <a className="upgrade" href="/account">
            Upgrade to unlock
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="lesson-detail">
      <LessonHeader lesson={lesson} />
      <LessonDiagram lesson={lesson} />
      <p className="lesson-intro">{lesson.intro}</p>
      <div className="lesson-blocks">
        {lesson.blocks.map((block) => (
          <LessonBlock key={block.heading} block={block} />
        ))}
      </div>
    </div>
  );
}

// Filler under the blur. Fixed text, never the lesson's: the hidden part is not on the page.
const PLACEHOLDER_HEADING = "Lorem ipsum dolor sit";
const PLACEHOLDER_BODY =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.";
const PLACEHOLDER_ITEMS = [
  "Lorem ipsum — dolor sit amet, consectetur adipiscing elit",
  "Sed do eiusmod — tempor incididunt ut labore et dolore",
  "Ut enim ad minim — veniam, quis nostrud exercitation",
];

/** A lesson for a signed-out visitor (coxwell via marcus, m62822): the first part as members see
 * it, then placeholder blocks under a blur with the sign-in card on top. Takes a SignedOutLesson,
 * which holds no text from the hidden part, so there is nothing here that could render it. */
export function LessonPreview({
  lesson,
  signInHref,
  signUpHref,
}: {
  lesson: SignedOutLesson;
  signInHref: string;
  signUpHref: string;
}) {
  return (
    <div className="lesson-detail">
      <LessonHeader lesson={lesson} />
      <LessonDiagram lesson={lesson} />
      <p className="lesson-intro">{lesson.intro}</p>
      {lesson.shownBlocks.length > 0 && (
        <div className="lesson-blocks">
          {lesson.shownBlocks.map((block) => (
            <LessonBlock key={block.heading} block={block} />
          ))}
        </div>
      )}
      <div className="lesson-gate">
        <div className="lesson-gate-skel" aria-hidden="true">
          {Array.from({ length: lesson.hiddenBlockCount }, (_, i) => (
            <div key={i} className="lesson-block">
              <div className="lb-head">
                <span className="lb-tag">Lesson</span>
                <h3>{PLACEHOLDER_HEADING}</h3>
              </div>
              <p>{PLACEHOLDER_BODY}</p>
              <ul>
                {PLACEHOLDER_ITEMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="lesson-gate-over">
          <div className="lesson-gate-card">
            <b>Sign in to read the full lesson.</b>
            <span>Free with a Horizon account.</span>
            <div className="lesson-gate-actions">
              <a className="btn primary sm" href={signInHref}>
                Sign in
              </a>
              <a className="btn ghost sm" href={signUpHref}>
                Create account
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
