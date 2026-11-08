import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Precomputed CRC32 table for valid PNG chunk generation
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Encodes a grayscale or RGB pixel buffer into a standard PNG Buffer.
 */
export function encodePngRgba(width, height, rgbaData) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per sample
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // Filter type 0 (None)
    rgbaData.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Normalizes a PNG input (data URL, base64 string, Buffer, or Uint8Array)
 * into { base64, mimeType, buffer }.
 */
export function normalizeImageInput(imageInput) {
  if (!imageInput) {
    return null;
  }

  if (Buffer.isBuffer(imageInput) || imageInput instanceof Uint8Array) {
    const buf = Buffer.from(imageInput);
    if (buf.length === 0) {
      throw new Error("Image buffer is empty.");
    }
    return {
      base64: buf.toString("base64"),
      mimeType: "image/png",
      buffer: buf,
    };
  }

  if (typeof imageInput === "string") {
    const trimmed = imageInput.trim();
    if (!trimmed) {
      throw new Error("Image string is empty.");
    }

    const dataUrlMatch = trimmed.match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/
    );
    if (dataUrlMatch) {
      const mimeType = dataUrlMatch[1].toLowerCase();
      const cleanBase64 = dataUrlMatch[2].replace(/\s+/g, "");
      const buffer = Buffer.from(cleanBase64, "base64");
      if (buffer.length === 0) {
        throw new Error("Decoded data URL image is empty.");
      }
      return { base64: cleanBase64, mimeType, buffer };
    }

    const cleanBase64 = trimmed.replace(/\s+/g, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    if (buffer.length < 8) {
      throw new Error("Invalid base64 image input.");
    }
    return {
      base64: cleanBase64,
      mimeType: "image/png",
      buffer,
    };
  }

  throw new Error(
    "Unsupported image input format. Expected base64 string, data URL, or Buffer."
  );
}

/**
 * Computes the bounding box { x, y, width, height, minX, minY, maxX, maxY } for a stroke.
 */
export function getStrokeBounds(stroke) {
  const points = Array.isArray(stroke?.points) ? stroke.points : [];
  if (points.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of points) {
    if (typeof pt?.x === "number" && typeof pt?.y === "number") {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    x: Math.floor(minX),
    y: Math.floor(minY),
    width: Math.max(1, Math.ceil(maxX - minX)),
    height: Math.max(1, Math.ceil(maxY - minY)),
  };
}

/**
 * Groups ordered strokes into candidate character clusters (left-to-right, top-to-bottom)
 * so recognized characters can link back to strokeIds and canvas bounds.
 */
export function clusterStrokesIntoCharacters(strokes = []) {
  const items = [];
  for (const stroke of strokes) {
    const b = getStrokeBounds(stroke);
    if (b && stroke?.id) {
      items.push({
        strokeId: stroke.id,
        minX: b.minX,
        minY: b.minY,
        maxX: b.maxX,
        maxY: b.maxY,
      });
    }
  }

  if (items.length === 0) {
    return [];
  }

  // Merge strokes that overlap or belong to the same character column
  let clusters = items.map((item) => ({
    strokeIds: [item.strokeId],
    minX: item.minX,
    minY: item.minY,
    maxX: item.maxX,
    maxY: item.maxY,
  }));

  const horizGap = 14;
  const vertGap = 36;
  const maxCharWidth = 105;
  const maxCharHeight = 110;

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const a = clusters[i];
        const b = clusters[j];

        const horizOverlap =
          a.minX <= b.maxX + horizGap && a.maxX >= b.minX - horizGap;
        const vertOverlap =
          a.minY <= b.maxY + vertGap && a.maxY >= b.minY - vertGap;

        const newMinX = Math.min(a.minX, b.minX);
        const newMaxX = Math.max(a.maxX, b.maxX);
        const newMinY = Math.min(a.minY, b.minY);
        const newMaxY = Math.max(a.maxY, b.maxY);

        if (
          horizOverlap &&
          vertOverlap &&
          newMaxX - newMinX <= maxCharWidth &&
          newMaxY - newMinY <= maxCharHeight
        ) {
          a.strokeIds.push(...b.strokeIds);
          a.minX = newMinX;
          a.minY = newMinY;
          a.maxX = newMaxX;
          a.maxY = newMaxY;
          clusters.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  // Sort clusters in reading order (top-to-bottom lines, then left-to-right)
  clusters.sort((a, b) => {
    const centerYA = (a.minY + a.maxY) / 2;
    const centerYB = (b.minY + b.maxY) / 2;
    if (Math.abs(centerYA - centerYB) > 70) {
      return centerYA - centerYB;
    }
    return a.minX - b.minX;
  });

  return clusters.map((c, index) => ({
    clusterIndex: index,
    strokeIds: c.strokeIds,
    bounds: {
      x: Math.round(c.minX),
      y: Math.round(c.minY),
      width: Math.max(4, Math.round(c.maxX - c.minX)),
      height: Math.max(4, Math.round(c.maxY - c.minY)),
    },
  }));
}

/**
 * Renders structured strokes into a high-contrast cropped PNG buffer (white background, dark ink).
 * Useful both as a fallback when only strokes are submitted and for generating test PNGs.
 */
export function renderStrokesToPng(strokes = [], options = {}) {
  const validStrokes = strokes.filter(
    (s) => Array.isArray(s?.points) && s.points.length > 0
  );
  if (validStrokes.length === 0) {
    throw new Error("Cannot render empty strokes to PNG.");
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of validStrokes) {
    const b = getStrokeBounds(stroke);
    if (b) {
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
  }

  const padding = options.padding ?? 28;
  const cropWidth = Math.max(64, Math.ceil(maxX - minX + padding * 2));
  const cropHeight = Math.max(64, Math.ceil(maxY - minY + padding * 2));
  const offsetX = minX - padding;
  const offsetY = minY - padding;

  // White background RGBA buffer
  const rgba = Buffer.alloc(cropWidth * cropHeight * 4, 255);

  const drawDisk = (cx, cy, radius) => {
    const rSq = (radius + 0.6) * (radius + 0.6);
    const startX = Math.max(0, Math.floor(cx - radius - 1));
    const endX = Math.min(cropWidth - 1, Math.ceil(cx + radius + 1));
    const startY = Math.max(0, Math.floor(cy - radius - 1));
    const endY = Math.min(cropHeight - 1, Math.ceil(cy + radius + 1));

    for (let py = startY; py <= endY; py += 1) {
      for (let px = startX; px <= endX; px += 1) {
        const dx = px - cx;
        const dy = py - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq <= rSq) {
          const idx = (py * cropWidth + px) * 4;
          // Slight anti-aliasing on outer edge
          const edge = Math.sqrt(distSq) - radius;
          const intensity = edge > 0 ? Math.round(255 * Math.min(1, edge)) : 15;
          if (intensity < rgba[idx]) {
            rgba[idx] = intensity;
            rgba[idx + 1] = intensity;
            rgba[idx + 2] = intensity;
            rgba[idx + 3] = 255;
          }
        }
      }
    }
  };

  for (const stroke of validStrokes) {
    const pts = stroke.points;
    for (let i = 0; i < pts.length; i += 1) {
      const p0 = pts[i];
      const p1 = pts[i + 1] ?? p0;
      const x0 = p0.x - offsetX;
      const y0 = p0.y - offsetY;
      const x1 = p1.x - offsetX;
      const y1 = p1.y - offsetY;
      const pressure = typeof p0.pressure === "number" ? p0.pressure : 0.5;
      const radius = Math.max(2.0, 2.2 + pressure * 2.2);

      const dist = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(dist * 2));
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        drawDisk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius);
      }
    }
  }

  const buffer = encodePngRgba(cropWidth, cropHeight, rgba);
  return {
    buffer,
    base64: buffer.toString("base64"),
    dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    width: cropWidth,
    height: cropHeight,
    offsetX,
    offsetY,
  };
}
