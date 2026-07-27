"use client";

import { useMemo, useState } from "react";
import { EDUCATION_CATEGORIES, type EducationCategoryKey, type EducationLesson } from "@/lib/education";

export function EducationCatalog({
  lessons,
  isPaidTier, // TODO: gate by license.tier once real license check is wired up
}: {
  lessons: EducationLesson[];
  isPaidTier: boolean;
}) {
  const [activeCategory, setActiveCategory] = useState<EducationCategoryKey | "all">("all");

  const chipCounts = useMemo(() => {
    const counts = new Map<EducationCategoryKey, number>();
    for (const lesson of lessons) counts.set(lesson.category, (counts.get(lesson.category) ?? 0) + 1);
    return counts;
  }, [lessons]);

  const categories = useMemo(
    () => EDUCATION_CATEGORIES.filter((c) => activeCategory === "all" || c.key === activeCategory),
    [activeCategory]
  );

  return (
    <>
      <div className="edu-chips">
        <button
          type="button"
          className={activeCategory === "all" ? "chip on" : "chip"}
          onClick={() => setActiveCategory("all")}
        >
          All <span className="n">{lessons.length}</span>
        </button>
        {EDUCATION_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            className={activeCategory === cat.key ? "chip on" : "chip"}
            onClick={() => setActiveCategory(cat.key)}
          >
            {cat.label} <span className="n">{chipCounts.get(cat.key) ?? 0}</span>
          </button>
        ))}
      </div>

      {categories.map((cat) => {
        const catLessons = lessons.filter((l) => l.category === cat.key);
        if (catLessons.length === 0) return null;
        return (
          <div className="edu-cat" key={cat.key}>
            <div className="edu-cat-head">
              <span className="dot" />
              <div className="edu-cat-txt">
                <h3>{cat.label}</h3>
                <span>{cat.subtitle}</span>
              </div>
              <span className="cnt">{catLessons.length} lessons</span>
            </div>
            <div className="edu-grid">
              {catLessons.map((lesson) => (
                <LessonCard key={lesson.slug} lesson={lesson} isPaidTier={isPaidTier} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function LessonCard({ lesson, isPaidTier }: { lesson: EducationLesson; isPaidTier: boolean }) {
  const locked = !lesson.free && !isPaidTier;

  if (locked) {
    return (
      <div className="lesson locked">
        <div className="lthumb">
          <span className="glyph">◈</span>
          <span className="veil">🔒</span>
        </div>
        <h4>{lesson.title}</h4>
        <p>{lesson.description}</p>
        <div className="lfoot">
          <span className="mins">{lesson.minutes} min</span>
          <span className="upgrade">Upgrade to unlock</span>
        </div>
      </div>
    );
  }

  return (
    <a className="lesson" href={`/education/${lesson.slug}`}>
      <div className="lthumb">
        <span className="glyph">◈</span>
      </div>
      {lesson.free && <div className="tag free">● Free</div>}
      <h4>{lesson.title}</h4>
      <p>{lesson.description}</p>
      <div className="lfoot">
        <span className="mins">{lesson.minutes} min</span>
        <span className="start">Start →</span>
      </div>
    </a>
  );
}
