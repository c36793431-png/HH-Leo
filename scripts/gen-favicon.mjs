import sharp from "sharp";
import { writeFileSync } from "fs";

const SVG = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 22 L12 13 L18 19 L29 8" stroke="#22d3ee" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M21 8 H29 V16" stroke="#22d3ee" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  for (const { size, buf } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buf.length;
    dirEntries.push(entry);
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers.map((p) => p.buf)]);
}

const sizes = [16, 32, 48];
const pngBuffers = [];
for (const size of sizes) {
  const buf = await sharp(Buffer.from(SVG(size)))
    .resize(size, size)
    .png()
    .toBuffer();
  pngBuffers.push({ size, buf });
}

writeFileSync(new URL("../src/app/favicon.ico", import.meta.url), buildIco(pngBuffers));
console.log("wrote favicon.ico");
