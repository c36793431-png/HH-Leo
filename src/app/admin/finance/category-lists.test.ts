// Every payment category must be listed in the Finance edit select and in the page's label/colour maps.
// The select falls back to its first option ('customer') when the row's value is missing, so a gap
// silently re-tags the row on save; the page maps are Record<string, string>, so tsc cannot catch one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PAYMENT_CATEGORIES } from "@/lib/payments";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

function block(src: string, name: string): string {
  const start = src.indexOf(`const ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const len = src.slice(start).search(/\n[}\]];/);
  assert.ok(len > 0, `${name} has no end`);
  return src.slice(start, start + len);
}

test("every PAYMENT_CATEGORIES value is an edit-select option", () => {
  const options = block(read("src/components/admin/payment-row-actions.tsx"), "CATEGORY_OPTIONS");
  for (const c of PAYMENT_CATEGORIES) assert.ok(options.includes(`value: "${c}"`), `CATEGORY_OPTIONS lacks ${c}`);
});

test("every PAYMENT_CATEGORIES value has a Finance label and colour", () => {
  const page = read("src/app/admin/finance/page.tsx");
  for (const name of ["CATEGORY_LABELS", "CATEGORY_STYLES"]) {
    const map = block(page, name);
    for (const c of PAYMENT_CATEGORIES) assert.ok(new RegExp(`\\n\\s+${c}:`).test(map), `${name} lacks ${c}`);
  }
});
