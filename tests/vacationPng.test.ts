import test from "node:test";
import assert from "node:assert/strict";
import { crc32, inflateSync } from "node:zlib";
import { encodeVacationPng } from "../src/vacationPng";

test("the faster PNG encoder preserves RGBA colors and writes valid chunks", async () => {
  const pixels = Uint8Array.from([
    100, 50, 25, 128, 0, 0, 0, 0,
    5, 17, 250, 255, 0, 128, 64, 128,
  ]);
  const png = await encodeVacationPng(2, 2, pixels);
  const chunks = new Map<string, Buffer>();
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const end = offset + 8 + size;
    assert.equal(png.readUInt32BE(end), crc32(png.subarray(offset + 4, end)));
    chunks.set(type, png.subarray(offset + 8, end));
    offset = end + 4;
  }
  assert.deepEqual([...chunks.keys()], ["IHDR", "IDAT", "IEND"]);
  const compressed = chunks.get("IDAT");
  assert.ok(compressed);
  assert.deepEqual([...inflateSync(compressed)], [
    0, 199, 100, 50, 128, 0, 0, 0, 0,
    0, 5, 17, 250, 255, 0, 255, 128, 128,
  ]);
});
