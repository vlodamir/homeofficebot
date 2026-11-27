import { promisify } from "node:util";
import { crc32, deflate } from "node:zlib";

const deflateAsync = promisify(deflate);
const signature = Buffer.from("89504e470d0a1a0a", "hex");

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.allocUnsafe(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, data.length + 8)), data.length + 8);
  return chunk;
}

export async function encodeVacationPng(width: number, height: number, pixels: Uint8Array): Promise<Buffer> {
  const rowBytes = width * 4;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== rowBytes * height) {
    throw new RangeError("The vacation PNG dimensions do not match its pixel buffer");
  }

  const scanlines = Buffer.allocUnsafe(pixels.length + height);
  for (let row = 0; row < height; row++) {
    const source = row * rowBytes;
    const start = row * (rowBytes + 1);
    const end = start + 1 + rowBytes;
    scanlines[start] = 0; // PNG filter None.
    scanlines.set(pixels.subarray(source, source + rowBytes), start + 1);

    // Resvg returns premultiplied RGBA, while PNG stores straight alpha.
    for (let pixel = start + 1; pixel < end; pixel += 4) {
      const alpha = scanlines[pixel + 3];
      if (alpha === 0 || alpha === 255) continue;
      const scale = 255 / alpha;
      scanlines[pixel] = Math.round(scanlines[pixel] * scale);
      scanlines[pixel + 1] = Math.round(scanlines[pixel + 1] * scale);
      scanlines[pixel + 2] = Math.round(scanlines[pixel + 2] * scale);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // PNG color type RGBA.
  const data = await deflateAsync(scanlines, { level: 3 });
  return Buffer.concat([signature, pngChunk("IHDR", header), pngChunk("IDAT", data), pngChunk("IEND", Buffer.alloc(0))]);
}
