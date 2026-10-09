import { EDUCATION_LESSONS, type EducationLesson } from "./education";
import { strategyCardImage, type StrategyCardImage } from "./basket-catalogue";

/** The Academy index's cards each get a thumbnail: a strategy lesson's is its marketplace card
 * diagram, the one the lesson page heads with (marcus m62977); every other lesson's is null, and the
 * card keeps the diamond glyph. Looked up by slug, because the signed-out index's cards are the
 * public catalogue's fields, which do not carry the strategy. */
export function withCardImages<T extends Pick<EducationLesson, "slug">>(cards: T[]): (T & { image: StrategyCardImage | null })[] {
  return cards.map((card) => {
    const strategy = EDUCATION_LESSONS.find((l) => l.slug === card.slug)?.strategy;
    return { ...card, image: strategy ? strategyCardImage(strategy) : null };
  });
}
