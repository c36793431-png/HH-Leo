import { useSyncExternalStore } from "react";
import type { BasketLineKind } from "./basket-catalogue";
import type { BundleFeedChoice } from "./bundle-catalogue";

/**
 * Client components only (it reads window); no "use client" so its functions stay callable.
 *
 * The request basket's client store (marcus m59113 (b), ruled m59146): localStorage until
 * submit, no server cart. /login and /signup are on the same origin, so a visitor's basket survives
 * signing in. It holds keys and counts only; names and availability come from the server's
 * catalogue on every render, and the server re-validates everything at submit.
 */

export interface StoredBasketLine {
  kind: BasketLineKind;
  key: string;
  /** Feed lines only. */
  servers?: number;
  /** Bundle lines only, and required there: the feed the client picked. */
  feed?: BundleFeedChoice;
}

/** Literal, not BUNDLE_FEED_CHOICES: a client module never value-imports a catalogue (Fable S2 C1). The server
 * re-checks the feed against the catalogue at submit, so this list only keeps junk out of the count. */
const isFeedChoice = (v: unknown) => v === "ld-base" || v === "ny-base";

const STORAGE_KEY = "hz-basket-v1";
const CHANGE_EVENT = "hz-basket-change";
const EMPTY: StoredBasketLine[] = [];

function isLine(v: unknown): v is StoredBasketLine {
  const l = v as StoredBasketLine | null;
  if (!l || typeof l.key !== "string") return false;
  if (l.kind === "bundle") return isFeedChoice(l.feed) && l.servers === undefined;
  return (
    (l.kind === "software" || l.kind === "strategy" || l.kind === "feed") &&
    (l.servers === undefined || (Number.isInteger(l.servers) && l.servers > 0))
  );
}

/** Exported for the test only. */
export const isStoredBasketLine = isLine;

// useSyncExternalStore needs the same array back while nothing changed, so the parse is cached
// against the raw string.
let cachedRaw: string | null = null;
let cachedLines: StoredBasketLine[] = EMPTY;

function readLines(): StoredBasketLine[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cachedRaw) return cachedLines;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    cachedLines = Array.isArray(parsed) ? parsed.filter(isLine) : EMPTY;
  } catch {
    cachedLines = EMPTY;
  }
  return cachedLines;
}

function writeLines(lines: StoredBasketLine[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Storage full or blocked: the basket simply doesn't persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The basket's lines. Empty during server render and hydration, then the stored lines. */
export function useBasket(): StoredBasketLine[] {
  return useSyncExternalStore(subscribe, readLines, () => EMPTY);
}

const same = (l: StoredBasketLine, kind: BasketLineKind, key: string) => l.kind === kind && l.key === key;

/** The lines after putting one: added, or replacing the existing line for the same product (one product = one
 * line). A bundle replaces ANY bundle line, of any key: one bundle per basket (Q-H; Fable S2 C4). */
export function putLine(lines: StoredBasketLine[], line: StoredBasketLine): StoredBasketLine[] {
  const replaces = (l: StoredBasketLine) => same(l, line.kind, line.key) || (line.kind === "bundle" && l.kind === "bundle");
  const i = lines.findIndex(replaces);
  if (i === -1) return [...lines, line];
  return lines.flatMap((l, j) => (j === i ? [line] : replaces(l) ? [] : [l]));
}

/** Adds a line, or replaces the existing line for the same product (putLine). */
export function basketPut(line: StoredBasketLine) {
  writeLines(putLine(readLines(), line));
}

export function basketRemove(kind: BasketLineKind, key: string) {
  writeLines(readLines().filter((l) => !same(l, kind, key)));
}

/** Keeps only the given products (the basket page drops lines the catalogue no longer offers). */
export function basketKeepOnly(keep: (l: StoredBasketLine) => boolean) {
  const lines = readLines();
  const kept = lines.filter(keep);
  if (kept.length !== lines.length) writeLines(kept);
}

export function basketClear() {
  writeLines([]);
}

// The basket page's step lives in its own component, but the portal topbar titles it ("Request
// sent" once sent, Iris r2 sheet 4), so the page publishes it here. In memory only: a reload is
// back on the basket step anyway.
export type BasketStep = "basket" | "review" | "sent";
let currentStep: BasketStep = "basket";
const stepListeners = new Set<() => void>();

export function setBasketStep(step: BasketStep) {
  if (step === currentStep) return;
  currentStep = step;
  stepListeners.forEach((l) => l());
}

function subscribeStep(onChange: () => void) {
  stepListeners.add(onChange);
  return () => {
    stepListeners.delete(onChange);
  };
}

export function useBasketStep(): BasketStep {
  return useSyncExternalStore(subscribeStep, () => currentStep, () => "basket" as BasketStep);
}
