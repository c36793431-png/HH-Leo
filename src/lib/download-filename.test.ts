/* Run: npx tsx --test src/lib/download-filename.test.ts
 *
 * The name a client's download is saved as (coxwell via marcus m68501/m68509): "HorizonHFT-<version>.zip" (or
 * "-macos.zip"), never the stored Blob name with the manual upload's random suffix, and a header that a hostile
 * version string cannot break. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadContentDisposition, downloadFilename } from "./downloads";

// The 2.0.8 row's shape: the manual upload's addRandomSuffix put "-<random>" before the extension.
const SUFFIXED = "downloads/windows/2.0.8/HorizonHFT-2.0.8-rKWhSvCurEuZGDx1y2z3.zip";

test("the 2.0.8 suffixed pathname downloads as HorizonHFT-2.0.8.zip", () => {
  assert.equal(downloadFilename("2.0.8", "windows", SUFFIXED), "HorizonHFT-2.0.8.zip");
});

test("a CI-published pathname (sha folder, no suffix) gets the same clean name", () => {
  assert.equal(downloadFilename("2.0.9", "windows", `downloads/windows/2.0.9/${"a".repeat(64)}/HorizonHFT-2.0.9.zip`), "HorizonHFT-2.0.9.zip");
});

test("macOS builds say so", () => {
  assert.equal(downloadFilename("2.0.8", "macos", "downloads/macos/2.0.8/HorizonHFT-2.0.8-Ab12Cd.zip"), "HorizonHFT-2.0.8-macos.zip");
  assert.equal(downloadFilename("2.0.8", "macos", "downloads/macos/2.0.8/Horizon-Ab12Cd.dmg"), "HorizonHFT-2.0.8-macos.dmg");
});

test("a hostile version string comes out as [A-Za-z0-9._-] only", () => {
  const cases: [string, string][] = [
    ['2.0.8"; filename="evil.exe', "HorizonHFT-2.0.8-filename-evil.exe.zip"],
    ["2.0.8\r\nSet-Cookie: x=1", "HorizonHFT-2.0.8-Set-Cookie-x-1.zip"],
    ["2.0/8", "HorizonHFT-2.0-8.zip"],
    ["../../2.0.8", "HorizonHFT-2.0.8.zip"],
    ["2.0.8-βeta", "HorizonHFT-2.0.8-eta.zip"],
    ["2.0.8‮piz.exe", "HorizonHFT-2.0.8-piz.exe.zip"],
  ];
  for (const [version, expected] of cases) {
    const name = downloadFilename(version, "windows", SUFFIXED);
    assert.equal(name, expected, JSON.stringify(version));
    assert.match(name, /^[A-Za-z0-9._-]+$/);
  }
});

test("an empty or unusable version falls back to HorizonHFT.zip", () => {
  for (const version of ["", "   ", "..", "---", "\r\n", "\"\"", "βγδ"]) {
    assert.equal(downloadFilename(version, "windows", SUFFIXED), "HorizonHFT.zip", JSON.stringify(version));
  }
  assert.equal(downloadFilename("", "macos", SUFFIXED), "HorizonHFT-macos.zip");
});

test("the extension is the stored file's, and .zip when it has none", () => {
  assert.equal(downloadFilename("2.0.8", "windows", "downloads/windows/2.0.8/HorizonHFT-2.0.8-x.exe"), "HorizonHFT-2.0.8.exe");
  assert.equal(downloadFilename("2.0.8", "windows", "downloads/windows/2.0.8/HorizonHFT-2.0.8"), "HorizonHFT-2.0.8.zip");
  assert.equal(downloadFilename("2.0.8", "windows", "downloads/windows/2.0.8/build.zip\"x"), "HorizonHFT-2.0.8.zip");
  assert.equal(downloadFilename("2.0.8", "windows", ""), "HorizonHFT-2.0.8.zip");
});

test("the header carries the plain and the RFC 5987 filename, with no quote or line break inside", () => {
  const header = downloadContentDisposition(downloadFilename("2.0.8", "windows", SUFFIXED));
  assert.equal(header, `attachment; filename="HorizonHFT-2.0.8.zip"; filename*=UTF-8''HorizonHFT-2.0.8.zip`);
  const hostile = downloadContentDisposition(downloadFilename('x"\r\ny', "windows", SUFFIXED));
  assert.equal((hostile.match(/"/g) ?? []).length, 2);
  assert.ok(!/[\r\n]/.test(hostile));
});
