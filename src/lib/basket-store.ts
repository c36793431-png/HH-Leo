import { useSyncExternalStore } from "react";
import type { BasketLineKind } from "./basket-catalogue";

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
}

const STORAGE_KEY = "hz-basket-v1";
const CHANGE_EVENT = "hz-basket-change";
const EMPTY: StoredBasketLine[] = [];

function isLine(v: unknown): v is StoredBasketLine {
  const l = v as StoredBasketLine | null;
  return (
    !!l &&
    (l.kind === "software" || l.kind === "strategy" || l.kind === "feed") &&
    typeof l.key === "string" &&
    (l.servers === undefined || (Number.isInteger(l.servers) && l.servers > 0))
  );
}

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

/** Adds a line, or replaces the existing line for the same product: one product = one line. */
export function basketPut(line: StoredBasketLine) {
  const lines = readLines();
  const i = lines.findIndex((l) => same(l, line.kind, line.key));
  writeLines(i === -1 ? [...lines, line] : lines.map((l, j) => (j === i ? line : l)));
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
