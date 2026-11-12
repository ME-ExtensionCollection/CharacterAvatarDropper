// A fake avatar for tests and the dev harness: dark background, a big skin
// area, purple hair, a red outfit and small green eyes. Skin is the largest
// non-background region, like most character portraits.
import { deflateSync, crc32 } from "node:zlib";

export const PARTS = Object.freeze({
  background: [30, 34, 48],
  skin: [241, 199, 165],
  hair: [123, 47, 247],
  outfit: [230, 57, 70],
  eyes: [25, 195, 125],
});

/** Which part is at (x, y) of a 120×120 avatar. */
export function partAt(x, y) {
  let part = "background";
  const dx = (x - 60) / 40;
  const dy = (y - 55) / 45;
  if (y >= 95) part = "outfit";
  else if (dx * dx + dy * dy <= 1) part = y < 28 ? "hair" : "skin";
  if ((Math.hypot(x - 45, y - 50) <= 4 || Math.hypot(x - 75, y - 50) <= 4) && part === "skin") part = "eyes";
  return part;
}

/** RGBA pixels, 120×120 times `scale`. */
export function fakeAvatar(scale = 1) {
  const width = 120 * scale;
  const height = 120 * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set([...PARTS[partAt(Math.floor(x / scale), Math.floor(y / scale))], 255], (y * width + x) * 4);
  }
  return { data, width, height };
}

/** Minimal RGBA PNG encoder. */
export function toPng({ data, width, height }) {
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "ascii");
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
