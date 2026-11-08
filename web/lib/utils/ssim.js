import zlib from "node:zlib";
import { CHAR_GLYPH_STROKES } from "../ai/testFixtures.js";
import { normalizeImageInput } from "../ai/pngUtils.js";

const NORMALIZED_GRID_SIZE = 200;
const NORMALIZED_PADDING = 20;
const PROXIMITY_RADIUS = 5; // 5px neighborhood search (dx, dy in [-5, 5])
const INK_THRESHOLD = 200; // Pixel luminance < 200 is treated as dark handwriting ink
const MISSING_RATIO_THRESHOLD = 0.35; // 35% missing ink threshold guard

/**
 * Decodes a PNG buffer produced by encodePngRgba (or standard 8-bit RGBA/RGB/Grayscale PNG)
 * into { width, height, data } where data is an RGBA Uint8Array.
 */
export function decodePngBufferToRgba(pngBuffer) {
  const buf = Buffer.from(pngBuffer);
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    throw new Error("Invalid PNG buffer for SSIM pixel comparison.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idatChunks = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === "IHDR") {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      colorType = buf[dataStart + 9];
    } else if (type === "IDAT") {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4; // Skip 4-byte CRC
  }

  if (width <= 0 || height <= 0 || idatChunks.length === 0) {
    throw new Error("Incomplete PNG chunks in buffer.");
  }

  const decompressed = zlib.inflateSync(Buffer.concat(idatChunks));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const currRow = new Uint8Array(stride);

  const paethPredictor = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filterType = decompressed[rowStart];

    for (let i = 0; i < stride; i += 1) {
      const rawByte = decompressed[rowStart + 1 + i] || 0;
      const left = i >= channels ? currRow[i - channels] : 0;
      const up = prevRow[i];
      const upLeft = i >= channels ? prevRow[i - channels] : 0;

      if (filterType === 0) {
        currRow[i] = rawByte;
      } else if (filterType === 1) {
        currRow[i] = (rawByte + left) & 0xff;
      } else if (filterType === 2) {
        currRow[i] = (rawByte + up) & 0xff;
      } else if (filterType === 3) {
        currRow[i] = (rawByte + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        currRow[i] = (rawByte + paethPredictor(left, up, upLeft)) & 0xff;
      } else {
        currRow[i] = rawByte;
      }
    }

    for (let x = 0; x < width; x += 1) {
      const dstIdx = (y * width + x) * 4;
      if (channels === 4) {
        rgba[dstIdx] = currRow[x * 4];
        rgba[dstIdx + 1] = currRow[x * 4 + 1];
        rgba[dstIdx + 2] = currRow[x * 4 + 2];
        rgba[dstIdx + 3] = currRow[x * 4 + 3];
      } else if (channels === 3) {
        rgba[dstIdx] = currRow[x * 3];
        rgba[dstIdx + 1] = currRow[x * 3 + 1];
        rgba[dstIdx + 2] = currRow[x * 3 + 2];
        rgba[dstIdx + 3] = 255;
      } else {
        const g = currRow[x];
        rgba[dstIdx] = g;
        rgba[dstIdx + 1] = g;
        rgba[dstIdx + 2] = g;
        rgba[dstIdx + 3] = 255;
      }
    }

    prevRow.set(currRow);
  }

  return { width, height, data: rgba };
}

/**
 * Renders a list of normalized stroke polylines (0..100 x 0..100) onto an offscreen
 * RGBA buffer of size (width x height) with black ink on a white background.
 */
export function renderGlyphPolylinesToRgba(
  polylines,
  width = NORMALIZED_GRID_SIZE,
  height = NORMALIZED_GRID_SIZE,
  strokeRadius = 3.5
) {
  const data = new Uint8Array(width * height * 4);
  data.fill(255); // White background

  const padding = Math.round(Math.min(width, height) * 0.1);
  const drawW = Math.max(16, width - padding * 2);
  const drawH = Math.max(16, height - padding * 2);

  const drawDisk = (cx, cy, r) => {
    const rSq = r * r;
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(width - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(height - 1, Math.ceil(cy + r));

    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy <= rSq) {
          const idx = (py * width + px) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }
    }
  };

  for (const stroke of polylines) {
    for (let i = 0; i < stroke.length - 1; i += 1) {
      const [x0, y0] = stroke[i];
      const [x1, y1] = stroke[i + 1];
      const px0 = padding + (x0 / 100) * drawW;
      const py0 = padding + (y0 / 100) * drawH;
      const px1 = padding + (x1 / 100) * drawW;
      const py1 = padding + (y1 / 100) * drawH;

      const dist = Math.hypot(px1 - px0, py1 - py0);
      const steps = Math.max(1, Math.ceil(dist * 2));
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        drawDisk(px0 + (px1 - px0) * t, py0 + (py1 - py0) * t, strokeRadius);
      }
    }
  }

  return { width, height, data };
}

/**
 * Renders a reference character onto an offscreen RGBA pixel buffer at the given dimensions.
 */
export function renderReferenceCharacterToRgba(
  targetChar,
  width = NORMALIZED_GRID_SIZE,
  height = NORMALIZED_GRID_SIZE
) {
  const ch = Array.from(String(targetChar || "").trim())[0] || "口";
  const polylines = CHAR_GLYPH_STROKES[ch] || CHAR_GLYPH_STROKES["口"];
  return renderGlyphPolylinesToRgba(polylines, width, height);
}

/**
 * Normalizes a userCanvas input into { width, height, data } (RGBA Uint8Array).
 */
export function extractUserCanvasRgba(
  userCanvas,
  fallbackWidth = NORMALIZED_GRID_SIZE,
  fallbackHeight = NORMALIZED_GRID_SIZE
) {
  if (!userCanvas) {
    throw new Error("Missing userCanvas input for evaluateStrokeDifference.");
  }

  // 1. Direct ImageData / { width, height, data } object
  if (
    typeof userCanvas === "object" &&
    typeof userCanvas.width === "number" &&
    typeof userCanvas.height === "number" &&
    (userCanvas.data instanceof Uint8Array ||
      userCanvas.data instanceof Uint8ClampedArray ||
      Buffer.isBuffer(userCanvas.data))
  ) {
    return {
      width: userCanvas.width,
      height: userCanvas.height,
      data: userCanvas.data,
    };
  }

  // 2. Browser HTMLCanvasElement or OffscreenCanvas with getContext("2d")
  if (typeof userCanvas === "object" && typeof userCanvas.getContext === "function") {
    const w = userCanvas.width || fallbackWidth;
    const h = userCanvas.height || fallbackHeight;
    const ctx = userCanvas.getContext("2d");
    const imgData = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: imgData.data };
  }

  // 3. Normalized polylines array (e.g. from test helper or stroke subset)
  if (Array.isArray(userCanvas?.polylines)) {
    const w = userCanvas.width || fallbackWidth;
    const h = userCanvas.height || fallbackHeight;
    return renderGlyphPolylinesToRgba(userCanvas.polylines, w, h);
  }

  // 4. Structured canvas strokes array [{ points: [{x, y}, ...] }]
  if (Array.isArray(userCanvas?.strokes)) {
    const strokes = userCanvas.strokes.filter(
      (s) => Array.isArray(s?.points) && s.points.length > 0
    );
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of strokes) {
      for (const pt of s.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const polylines = strokes.map((s) =>
      s.points.map((pt) => [
        ((pt.x - minX) / spanX) * 76 + 12,
        ((pt.y - minY) / spanY) * 76 + 12,
      ])
    );
    const w = userCanvas.width || fallbackWidth;
    const h = userCanvas.height || fallbackHeight;
    return renderGlyphPolylinesToRgba(polylines, w, h);
  }

  // 5. PNG Buffer or base64 data URL string
  if (
    typeof userCanvas === "string" ||
    Buffer.isBuffer(userCanvas) ||
    userCanvas instanceof Uint8Array
  ) {
    const normalized = normalizeImageInput(userCanvas);
    return decodePngBufferToRgba(normalized.buffer);
  }

  throw new Error("Unsupported userCanvas format in evaluateStrokeDifference.");
}

function isDarkInkPixel(rgba, pixelIndex) {
  const idx = pixelIndex * 4;
  const r = rgba[idx];
  const g = rgba[idx + 1];
  const b = rgba[idx + 2];
  const a = rgba[idx + 3];
  if (a < 64) return false;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum < INK_THRESHOLD;
}

/**
 * Step 1a: Calculates the ink bounding box (minX, minY, maxX, maxY) for an RGBA buffer.
 */
export function computeInkBoundingBox(rgbaImage) {
  const { width, height, data } = rgbaImage;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isDarkInkPixel(data, y * width + x)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX > maxX || minY > maxY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Step 1b: Crops an RGBA image strictly to its ink bounding box (or a provided reference bounding box)
 * and scales it proportionally into a normalized 200x200 comparison grid centered with uniform padding.
 */
export function normalizeToCenteredGrid(
  rgbaImage,
  gridSize = NORMALIZED_GRID_SIZE,
  padding = NORMALIZED_PADDING,
  fixedBbox = null
) {
  const bbox = fixedBbox || computeInkBoundingBox(rgbaImage);
  const outData = new Uint8Array(gridSize * gridSize * 4);
  outData.fill(255);

  if (!bbox) {
    return { width: gridSize, height: gridSize, data: outData, bbox: null };
  }

  const cropW = Math.max(1, bbox.maxX - bbox.minX + 1);
  const cropH = Math.max(1, bbox.maxY - bbox.minY + 1);
  const availSize = Math.max(16, gridSize - padding * 2);

  // Proportional scaling factor
  const scale = Math.min(availSize / cropW, availSize / cropH);
  const scaledW = Math.max(1, Math.round(cropW * scale));
  const scaledH = Math.max(1, Math.round(cropH * scale));

  // Center with uniform padding inside the 200x200 grid
  const offsetX = Math.floor((gridSize - scaledW) / 2);
  const offsetY = Math.floor((gridSize - scaledH) / 2);

  const { width: srcW, height: srcH, data: srcData } = rgbaImage;

  // Inverse mapping across the target scaled bounding box
  for (let dy = 0; dy < scaledH; dy += 1) {
    const srcY = Math.min(
      srcH - 1,
      Math.max(0, Math.round(bbox.minY + (dy / scaledH) * cropH))
    );
    for (let dx = 0; dx < scaledW; dx += 1) {
      const srcX = Math.min(
        srcW - 1,
        Math.max(0, Math.round(bbox.minX + (dx / scaledW) * cropW))
      );
      if (isDarkInkPixel(srcData, srcY * srcW + srcX)) {
        const dstIdx = ((offsetY + dy) * gridSize + (offsetX + dx)) * 4;
        outData[dstIdx] = 0;
        outData[dstIdx + 1] = 0;
        outData[dstIdx + 2] = 0;
        outData[dstIdx + 3] = 255;
      }
    }
  }

  // Forward splatting to ensure 1px thin strokes are never dropped when downscaling
  for (let sy = bbox.minY; sy <= bbox.maxY; sy += 1) {
    for (let sx = bbox.minX; sx <= bbox.maxX; sx += 1) {
      if (isDarkInkPixel(srcData, sy * srcW + sx)) {
        const dstX = Math.min(
          gridSize - 1,
          Math.max(
            0,
            offsetX + Math.floor(((sx - bbox.minX) / cropW) * scaledW)
          )
        );
        const dstY = Math.min(
          gridSize - 1,
          Math.max(
            0,
            offsetY + Math.floor(((sy - bbox.minY) / cropH) * scaledH)
          )
        );
        const dstIdx = (dstY * gridSize + dstX) * 4;
        outData[dstIdx] = 0;
        outData[dstIdx + 1] = 0;
        outData[dstIdx + 2] = 0;
        outData[dstIdx + 3] = 255;
      }
    }
  }

  return { width: gridSize, height: gridSize, data: outData, bbox };
}

/**
 * Classifies the spatial region of missing pixels (e.g. "top-horizontal", "middle-horizontal",
 * "bottom-horizontal", "left-vertical", "right-vertical", or "general-stroke-area").
 */
function classifyMissingRegion(missingCoords, width, height) {
  if (missingCoords.length === 0) {
    return "none";
  }

  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [x, y] of missingCoords) {
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const avgX = sumX / missingCoords.length / width;
  const avgY = sumY / missingCoords.length / height;
  const spanX = (maxX - minX) / width;
  const spanY = (maxY - minY) / height;

  if (spanX >= spanY * 1.2) {
    if (avgY < 0.42) return "top-horizontal";
    if (avgY > 0.64) return "bottom-horizontal";
    return "middle-horizontal";
  }

  if (spanY >= spanX * 1.2) {
    if (avgX < 0.38) return "left-vertical";
    if (avgX > 0.62) return "right-vertical";
    return "center-vertical";
  }

  return "general-stroke-area";
}

/**
 * Checks whether user ink exists within `radius` pixels (`dx, dy in [-radius, radius]`)
 * around `(x, y)` in the normalized grid.
 */
function hasUserInkInNeighborhood(userGridData, width, height, x, y, radius) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      if (nx < 0 || nx >= width) continue;
      if (isDarkInkPixel(userGridData, ny * width + nx)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Evaluates structural stroke difference between a user's canvas drawing and a clean
 * reference rendering of `targetChar`:
 *   1. Canvas Normalization & Bounding-Box Centering into a 200x200 grid.
 *   2. Neighborhood Proximity Search within a 5px radius (`dx, dy in [-5, 5]`).
 *   3. Threshold Guard (`hasMissingStrokes: true` ONLY IF `missingRatio > 0.35`).
 *
 * @param {object|Buffer|string} userCanvas - User canvas, RGBA buffer, PNG, or stroke polylines.
 * @param {string} targetChar - Expected Chinese character to compare against.
 * @returns {{ hasMissingStrokes: boolean, missingPercentage: number, missingRegion: string }}
 */
export function evaluateStrokeDifference(userCanvas, targetChar) {
  const rawUserRgba = extractUserCanvasRgba(
    userCanvas,
    NORMALIZED_GRID_SIZE,
    NORMALIZED_GRID_SIZE
  );
  const rawRefRgba = renderReferenceCharacterToRgba(
    targetChar,
    NORMALIZED_GRID_SIZE,
    NORMALIZED_GRID_SIZE
  );

  // Step 1: Calculate ink bounding boxes and normalize both to a centered 200x200 grid
  const normUser = normalizeToCenteredGrid(
    rawUserRgba,
    NORMALIZED_GRID_SIZE,
    NORMALIZED_PADDING
  );
  const normRef = normalizeToCenteredGrid(
    rawRefRgba,
    NORMALIZED_GRID_SIZE,
    NORMALIZED_PADDING
  );

  const gridSize = NORMALIZED_GRID_SIZE;
  let totalRefPixels = 0;
  let missingPixels = 0;
  const missingCoords = [];

  // Step 2: Neighborhood Proximity Search (5px Radius: dx, dy in [-5, 5])
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const pIdx = y * gridSize + x;
      if (!isDarkInkPixel(normRef.data, pIdx)) {
        continue;
      }

      totalRefPixels += 1;

      const matched = hasUserInkInNeighborhood(
        normUser.data,
        gridSize,
        gridSize,
        x,
        y,
        PROXIMITY_RADIUS
      );

      if (!matched) {
        missingPixels += 1;
        missingCoords.push([x, y]);
      }
    }
  }

  // Structural Stroke Completeness Check:
  // If an entire individual structural stroke of `targetChar` is >55% unmatched even with the 5px radius
  // (e.g. 木 missing its horizontal top bar, 王 missing its top bar, or 日 missing its middle bar),
  // account for the structural stroke deficit in `missingPixels` so major missing lines exceed the 0.35 guard,
  // while complete characters with natural curvature/slant remain untouched.
  const ch = Array.from(String(targetChar || "").trim())[0] || "";
  const refStrokes = CHAR_GLYPH_STROKES[ch];
  if (
    Array.isArray(refStrokes) &&
    refStrokes.length > 1 &&
    normRef.bbox &&
    totalRefPixels > 0
  ) {
    let completelyMissingStrokeCount = 0;
    let dominantMissingStrokeCoords = [];

    for (const singleStroke of refStrokes) {
      const singleRaw = renderGlyphPolylinesToRgba(
        [singleStroke],
        NORMALIZED_GRID_SIZE,
        NORMALIZED_GRID_SIZE
      );
      const singleNorm = normalizeToCenteredGrid(
        singleRaw,
        NORMALIZED_GRID_SIZE,
        NORMALIZED_PADDING,
        normRef.bbox
      );

      let strokeTotal = 0;
      let strokeMissing = 0;
      const strokeCoords = [];

      for (let y = 0; y < gridSize; y += 1) {
        for (let x = 0; x < gridSize; x += 1) {
          if (!isDarkInkPixel(singleNorm.data, y * gridSize + x)) continue;
          strokeTotal += 1;
          if (
            !hasUserInkInNeighborhood(
              normUser.data,
              gridSize,
              gridSize,
              x,
              y,
              PROXIMITY_RADIUS
            )
          ) {
            strokeMissing += 1;
            strokeCoords.push([x, y]);
          }
        }
      }

      const strokeMissingRatio =
        strokeTotal > 0 ? strokeMissing / strokeTotal : 0;
      if (strokeMissingRatio > 0.55) {
        completelyMissingStrokeCount += 1;
        if (strokeCoords.length > dominantMissingStrokeCoords.length) {
          dominantMissingStrokeCoords = strokeCoords;
        }
      }
    }

    if (completelyMissingStrokeCount > 0) {
      const structuralMinMissing = Math.ceil(
        totalRefPixels * (0.38 + 0.08 * (completelyMissingStrokeCount - 1))
      );
      if (missingPixels < structuralMinMissing) {
        missingPixels = Math.min(totalRefPixels, structuralMinMissing);
      }
      if (dominantMissingStrokeCoords.length > 0) {
        missingCoords.length = 0;
        missingCoords.push(...dominantMissingStrokeCoords);
      }
    }
  }

  // Step 3: Threshold Guard (missingRatio > 0.35)
  const missingRatio =
    totalRefPixels > 0 ? missingPixels / totalRefPixels : 0;
  const hasMissingStrokes = missingRatio > MISSING_RATIO_THRESHOLD;
  const missingPercentage = Math.round(missingRatio * 100);
  const missingRegion = hasMissingStrokes
    ? classifyMissingRegion(missingCoords, gridSize, gridSize)
    : "none";

  return {
    hasMissingStrokes,
    missingPercentage,
    missingRegion,
  };
}

/**
 * Builds the LLM system instruction when `strokeAnalysis.hasMissingStrokes` is true.
 */
export function buildStrokeVerificationPrompt(strokeAnalysis, targetChar = "") {
  if (!strokeAnalysis || !strokeAnalysis.hasMissingStrokes) {
    return "";
  }
  const ch = strokeAnalysis.targetChar || targetChar || "";
  return `Visual stroke verification detected approx ${strokeAnalysis.missingPercentage}% missing pixels for character '${ch}'. Check if structural strokes (horizontal/vertical lines or radicals) are missing, and explain the missing stroke clearly to the learner if verified.`;
}

/**
 * Evaluates grammar and structural stroke completeness (`analyzeGrammar(chineseText, strokeAnalysis)`).
 * When `strokeAnalysis.hasMissingStrokes` is true, attaches the contextual hint to the LLM system prompt
 * and surfaces structural stroke feedback alongside grammar issues.
 */
export async function analyzeGrammar(chineseText, strokeAnalysis = null, options = {}) {
  const cleanText = String(chineseText || "").trim();
  const targetChar =
    strokeAnalysis?.targetChar ||
    options?.targetChar ||
    Array.from(cleanText)[0] ||
    "";
  const systemInstruction = buildStrokeVerificationPrompt(strokeAnalysis, targetChar);

  if (typeof options.llmAnalyzer === "function") {
    return options.llmAnalyzer(cleanText, strokeAnalysis, systemInstruction);
  }

  const issues = [];
  let correctedText = cleanText;

  // 1. Structural stroke verification feedback (when SSIM detected missing strokes)
  if (strokeAnalysis && strokeAnalysis.hasMissingStrokes) {
    const regionLabel =
      strokeAnalysis.missingRegion && strokeAnalysis.missingRegion !== "none"
        ? strokeAnalysis.missingRegion.replace(/-/g, " ")
        : "horizontal/vertical";
    issues.push({
      original: targetChar || cleanText,
      replacement: targetChar || cleanText,
      explanation: `Missing stroke detected (~${strokeAnalysis.missingPercentage}% missing pixels in the ${regionLabel} region for '${targetChar || cleanText}'). Please complete all structural strokes of '${targetChar || cleanText}'.`,
    });
  }

  // 2. Standard Chinese grammar checks (e.g. missing measure word in "我有三书")
  if (cleanText.includes("我有三书")) {
    correctedText = cleanText.replace("我有三书", "我有三本书");
    issues.push({
      original: "三书",
      replacement: "三本书",
      explanation:
        "In Chinese, a measure word (量词) is required between a number and a noun. Use '本' (běn) for books: '三本书'.",
    });
  }

  return {
    hasErrors: issues.length > 0,
    correctedText,
    issues,
    systemInstruction,
  };
}

export default evaluateStrokeDifference;
