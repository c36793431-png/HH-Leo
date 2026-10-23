import {
  EDUCATION_CATEGORIES,
  EDUCATION_MANUAL_TOTAL_SECTIONS,
  EDUCATION_MANUAL_VERSION,
  type EducationBlock,
  type EducationLesson,
  lessonHref,
  nextCourseLesson,
} from "@/lib/education";
import type { SignedOutLesson } from "@/lib/education-signed-out";
import { strategyCardImage } from "@/lib/basket-catalogue";

const BLOCK_LABEL: Record<EducationBlock["type"], string> = {
  info: "Info",
  setting: "Setting",
  warning: "Warning",
  blocked: "Requirement",
};

function LessonHeader({ lesson }: { lesson: Pick<EducationLesson, "title" | "section" | "category" | "course"> }) {
  const category = EDUCATION_CATEGORIES.find((c) => c.key === lesson.category);
  return (
    <div className="lesson-head">
      <a className="lesson-back" href="/education">
        ← Back to Horizon Academy
      </a>
      <div className="lesson-head-row">
        <div className="lesson-badge">{lesson.course ? (lesson.course.final ? "✓" : lesson.course.lesson) : lesson.section}</div>
        <div className="lesson-head-txt">
          <h1>{lesson.title}</h1>
          {lesson.course ? (
            <span>
              {lesson.course.name} ·{" "}
              <span className="nw">{lesson.course.final ? "Final check" : `Lesson ${lesson.course.lesson} of ${lesson.course.of}`}</span>
            </span>
          ) : (
            <span>
              Horizon HFT User Tutorial {EDUCATION_MANUAL_VERSION} · Section {lesson.section} of{" "}
              {EDUCATION_MANUAL_TOTAL_SECTIONS} · {category?.label}
            </span>
          )}
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
        <span className="lb-tag">{block.tag ?? BLOCK_LABEL[block.type]}</span>
        <h3>{block.heading}</h3>
      </div>
      {block.body && <p>{block.body}</p>}
      {block.items && block.items.length > 0 && (
        <ul>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {block.image && (
        <figure className="lb-figure">
          <a href={block.image.src} target="_blank" rel="noopener noreferrer" style={{ maxWidth: block.image.width + 2 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={block.image.src} alt={block.image.alt} width={block.image.width} height={block.image.height} loading="lazy" />
          </a>
          <figcaption>{block.image.caption}</figcaption>
        </figure>
      )}
      {block.parts?.map((part, i) => (
        <div key={i} className="lb-part">
          {part.label && <h4 className="lb-part-label">{part.label}</h4>}
          {part.text && <p>{part.text}</p>}
          {part.code && (
            <pre className="lb-code">
              <code>{part.code}</code>
            </pre>
          )}
        </div>
      ))}
      {block.qa && block.qa.length > 0 && (
        <div className="lb-qa">
          {block.qa.map((x) => (
            <details key={x.q}>
              <summary>{x.q}</summary>
              <p>{x.a}</p>
            </details>
          ))}
        </div>
      )}
      {block.links && block.links.length > 0 && (
        <ul className="lb-links">
          {block.links.map((x) => (
            <li key={x.href}>
              <a href={x.href} target="_blank" rel="noopener noreferrer">
                {x.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The foot of a course lesson: a link to the next one (marcus m67166). Lesson 7 leads to the final check. */
function NextCourseLesson({ lesson }: { lesson: EducationLesson }) {
  const next = nextCourseLesson(lesson);
  if (!next) return null;
  return (
    <a className="lesson-next" href={lessonHref(next)}>
      <span>{next.course?.final ? "Next" : "Next lesson"}</span>
      <b>{next.title} →</b>
    </a>
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
      {lesson.closing && <p className="lesson-closing">{lesson.closing}</p>}
      <NextCourseLesson lesson={lesson} />
    </div>
  );
}

// Filler under the blur: text-free grey bars (marcus m73402, as on www m72899 A), never the lesson's text: the hidden
// part is not on the page. Widths in %: heading, three body lines, three list items, the old filler's footprint.
const SKEL_HEADING = 42;
const SKEL_BODY = [100, 96, 62];
const SKEL_ITEMS = [78, 70, 64];

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
                <span className="lgs-bar h" style={{ width: `${SKEL_HEADING}%` }} />
              </div>
              {SKEL_BODY.map((w, j) => (
                <span key={j} className="lgs-bar" style={{ width: `${w}%` }} />
              ))}
              <ul className="lgs-list">
                {SKEL_ITEMS.map((w, j) => (
                  <li key={j}>
                    <span className="lgs-bar" style={{ width: `${w}%` }} />
                  </li>
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
