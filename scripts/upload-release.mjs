#!/usr/bin/env node
/* Upload one client build to the portal as a DRAFT (agent-release-upload-2026-10-13: plan m66654 +
 * m66679, Fable m66680, marcus GO m66684). The uploader (FOC12) runs this; it can't publish. An admin
 * publishes from /admin/downloads after comparing version + sha256 with the banked build log.
 *
 * Setup, once: put this file in an empty folder and run `npm init -y && npm install @vercel/blob@2.6.1`
 * there (Node >= 20). Run:
 *   PUBLISH_API_TOKEN=... node upload-release.mjs --zip <build.zip> --mapping <Mapping.txt> \
 *     --version 2.1 --platform windows [--changelog-file <notes.txt>] [--portal https://portal.horizonhft.com]
 * The token comes from the environment only and is never printed.
 *
 * Steps: hash both files (sha256 + size, from the bytes it uploads) -> phase 1 (two upload tokens)
 * -> PUT both straight to Blob, private -> confirm (the server re-hashes both and records a draft).
 * A PUT that fails is reported and confirm still runs: confirm checks what is actually stored and
 * refuses if it is missing or differs, so a re-run after a half-finished run is safe.
 *
 * Exit codes: 0 draft recorded; 1 refused or failed (any other non-2xx); 2 this version already has
 * a row, draft or published (an admin Deletes it before a rebuild); 3 confirm timed out but the
 * row landed (check /admin/downloads); 4 confirm timed out and nothing landed (re-run). */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob/client";

const USAGE =
  "usage: PUBLISH_API_TOKEN=... node upload-release.mjs --zip <file.zip> --mapping <Mapping.txt> --version <e.g. 2.1 / 2.0.9> --platform windows|macos [--changelog-file <file>] [--portal <url>]";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) fail(1, USAGE);
    out[key.slice(2)] = value;
  }
  return out;
}

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

function describe(file, bytes) {
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength, file };
}

async function postJson(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (a platform error page): reported by status below.
  }
  return { status: res.status, json, text };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.PUBLISH_API_TOKEN;
  if (!token) fail(1, "PUBLISH_API_TOKEN is not set");
  if (!args.zip || !args.mapping || !args.version || !args.platform) fail(1, USAGE);
  const portal = (args.portal ?? "https://portal.horizonhft.com").replace(/\/+$/, "");

  const zipBytes = await readFile(args.zip);
  const mapBytes = await readFile(args.mapping);
  const zip = describe(args.zip, zipBytes);
  const map = describe(args.mapping, mapBytes);
  const filename = path.basename(args.zip);
  const changelog = args["changelog-file"] ? await readFile(args["changelog-file"], "utf8") : undefined;
  console.log(`version ${args.version} (${args.platform})`);
  console.log(`zip     ${filename}  sha256 ${zip.sha256}  ${zip.size} B`);
  console.log(`mapping ${path.basename(args.mapping)}  sha256 ${map.sha256}  ${map.size} B`);

  const phase1Body = { version: args.version, platform: args.platform, sha256: zip.sha256, size: zip.size, filename };
  const phase1 = await postJson(`${portal}/api/admin/publish-build`, token, phase1Body);
  if (phase1.status === 409) fail(2, `refused 409: ${phase1.json?.error ?? phase1.text}`);
  if (phase1.status < 200 || phase1.status > 299) fail(1, `phase 1 failed ${phase1.status}: ${phase1.json?.error ?? phase1.text}`);
  const { buildUpload, mappingUpload } = phase1.json;

  for (const [label, upload, bytes, contentType] of [
    ["zip", buildUpload, zipBytes, "application/zip"],
    ["mapping", mappingUpload, mapBytes, "text/plain"],
  ]) {
    try {
      await put(upload.pathname, bytes, { access: "private", token: upload.token, contentType, multipart: bytes.byteLength > 8 * 1024 * 1024 });
      console.log(`stored  ${label} at ${upload.pathname}`);
    } catch (err) {
      console.log(`PUT ${label} failed (${err?.name ?? "Error"}: ${err?.message ?? err}); confirm will check what is stored at ${upload.pathname}`);
    }
  }

  const confirmBody = {
    version: args.version,
    platform: args.platform,
    filename,
    sha256: zip.sha256,
    sizeBytes: zip.size,
    mappingSha256: map.sha256,
    mappingSizeBytes: map.size,
    changelog,
  };
  let confirm;
  try {
    confirm = await postJson(`${portal}/api/admin/publish-build/confirm`, token, confirmBody);
  } catch (err) {
    confirm = { status: 0, json: null, text: String(err) };
  }
  if (confirm.status >= 200 && confirm.status <= 299) {
    console.log(`DRAFT recorded: id ${confirm.json?.id}. Not live: an admin publishes it from /admin/downloads.`);
    return;
  }
  if (confirm.status !== 504 && confirm.status !== 0) {
    fail(confirm.status === 409 ? 2 : 1, `confirm refused ${confirm.status}: ${confirm.json?.error ?? confirm.text}`);
  }

  // 504 or no response: unknown state. Phase 1 answers 409 once the row exists.
  console.log(`confirm gave no answer (${confirm.status || confirm.text}); re-checking via phase 1`);
  const recheck = await postJson(`${portal}/api/admin/publish-build`, token, phase1Body);
  if (recheck.status === 409) fail(3, "the draft row landed; check it in /admin/downloads before anyone publishes");
  if (recheck.status >= 200 && recheck.status <= 299) fail(4, "nothing landed; re-run this script (stored files are re-checked, not trusted)");
  fail(1, `re-check failed ${recheck.status}: ${recheck.json?.error ?? recheck.text}`);
}

main().catch((err) => fail(1, `failed: ${err?.message ?? err}`));
