import { EDUCATION_CATEGORIES, EDUCATION_LESSONS, type EducationCategory, type EducationLesson } from "./education";

/** Words that must never reach the public catalogue (marcus, m59051). Matched case-insensitively
 * against the whole serialised payload, keys included. Also guards the signed-out lesson preview
 * (education-signed-out.ts), which added the "disguises its footprint" class (marcus, m62833). */
export const DO_NOT_PUBLISH = ["stealth", "order mixer", "disguis", "footprint"];

export type PublicEducationLesson = Pick<
  EducationLesson,
  "slug" | "title" | "description" | "category" | "minutes" | "free" | "section"
>;

export type PublicEducationCatalogue = {
  categories: EducationCategory[];
  lessons: PublicEducationLesson[];
};

/** The Academy catalogue as www/education reads it at build time (GET /api/public/education-catalogue).
 * Card fields only: no intro, no blocks. A field is copied by name, so a field added to
 * EducationLesson later stays private until it is added here.
 *
 * Throws when a do-not-publish word is in the payload. The route is prerendered, so that fails
 * `next build` and the deploy, and the live payload stays the previous one. */
export function publicEducationCatalogue(): PublicEducationCatalogue {
  const catalogue: PublicEducationCatalogue = {
    categories: EDUCATION_CATEGORIES.map(({ key, label, subtitle }) => ({ key, label, subtitle })),
    lessons: EDUCATION_LESSONS.map((lesson) => ({
      slug: lesson.slug,
      title: lesson.publicTitle ?? lesson.title,
      description: lesson.publicDescription ?? lesson.description,
      category: lesson.category,
      minutes: lesson.minutes,
      free: lesson.free,
      section: lesson.section,
    })),
  };
  const text = JSON.stringify(catalogue).toLowerCase();
  const leaked = DO_NOT_PUBLISH.filter((word) => text.includes(word));
  if (leaked.length > 0) {
    throw new Error(`Public education catalogue contains do-not-publish words: ${leaked.join(", ")}`);
  }
  return catalogue;
}
