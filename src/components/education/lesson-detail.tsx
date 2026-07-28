import {
  EDUCATION_CATEGORIES,
  EDUCATION_MANUAL_TOTAL_SECTIONS,
  EDUCATION_MANUAL_VERSION,
  type EducationBlock,
  type EducationLesson,
} from "@/lib/education";

const BLOCK_LABEL: Record<EducationBlock["type"], string> = {
  info: "Info",
  setting: "Setting",
  warning: "Warning",
  blocked: "Requirement",
};

function LessonHeader({ lesson }: { lesson: EducationLesson }) {
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
      <p className="lesson-intro">{lesson.intro}</p>
      <div className="lesson-blocks">
        {lesson.blocks.map((block) => (
          <LessonBlock key={block.heading} block={block} />
        ))}
      </div>
    </div>
  );
}
