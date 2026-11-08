import { evaluateStrokeDifference, decodePngBufferToRgba } from "../utils/ssim.js";
import { CHAR_GLYPH_STROKES } from "./testFixtures.js";
import { getVisualCharacterOptions } from "./ocr.js";
import { validBounds } from "./coverage.mjs";

function intersection(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

function crop(image, box) {
  const left = Math.floor(box.x);
  const top = Math.floor(box.y);
  const width = Math.ceil(box.x + box.width) - left;
  const height = Math.ceil(box.y + box.height) - top;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = ((top + y) * image.width + left) * 4;
    data.set(image.data.subarray(start, start + width * 4), y * width * 4);
  }
  return { width, height, data };
}

/** Advisory shape warnings only; never replace OCR text or change confidence. */
export function findShapeCandidates(imageBuffer, spatial, characters, segments, candidates, intentTargets) {
  if (!spatial || !characters.length || spatial.regions.some((region) => region.ambiguous) ||
    segments.map((segment) => segment.text).join("") !== characters.map((character) => character.text).join("")) return [];
  // The existing decoder supports non-interlaced 8-bit grayscale/RGB/RGBA only.
  // Skip other formats rather than interpreting palette indices as real ink.
  if (imageBuffer.length < 33 || imageBuffer.toString("ascii", 12, 16) !== "IHDR" ||
    imageBuffer[24] !== 8 || ![0, 2, 6].includes(imageBuffer[25]) ||
    imageBuffer[26] !== 0 || imageBuffer[27] !== 0 || imageBuffer[28] !== 0 ||
    imageBuffer.readUInt32BE(16) !== spatial.width || imageBuffer.readUInt32BE(20) !== spatial.height) return [];

  let offset = 0;
  const scored = segments.map((segment) => {
    const start = offset;
    offset += Array.from(segment.text).length;
    return { ...segment, start, end: offset };
  });
  let image;
  const warnings = [];
  for (const character of characters) {
    const { text, start, end, bounds } = character;
    // Never use the checker's fallback glyph for an unsupported character.
    if (end !== start + 1 || !/^\p{Script=Han}$/u.test(text) || !Object.hasOwn(CHAR_GLYPH_STROKES, text) ||
      !validBounds(bounds, spatial.width, spatial.height) || candidates.some((candidate) => candidate.position === start) ||
      intentTargets.some((target) => target.start < end && target.end > start)) continue;
    const segment = scored.find((entry) => entry.start === start && entry.end === end);
    if (!segment || segment.confidence === null || segment.confidence < 0.90) continue;
    const matches = spatial.regions.filter((region) => intersection(region.bounds, bounds) > 0);
    if (matches.length !== 1) continue;
    const region = matches[0];
    const otherSymbols = characters.filter((entry) => entry.bounds && intersection(entry.bounds, region.bounds) > 0);
    const overlap = intersection(bounds, region.bounds);
    if (otherSymbols.length !== 1 || overlap / (bounds.width * bounds.height) < 0.7 ||
      overlap / (region.bounds.width * region.bounds.height) < 0.7) continue;
    // Crop all stored ink in the matched region, not just the detected strokes.
    // Decode once per request. Unusable images retain the ordinary OCR safeguards.
    if (!image) {
      try { image = decodePngBufferToRgba(imageBuffer); }
      catch { return []; }
      if (image.width !== spatial.width || image.height !== spatial.height) return [];
    }
    try {
      const result = evaluateStrokeDifference(crop(image, region.bounds), text);
      if (!result.hasMissingStrokes) continue;
    } catch { continue; }
    const alternatives = getVisualCharacterOptions(text).slice(0, 2);
    if (!alternatives.length) continue;
    warnings.push({ position: start, originalAttempt: text, confidence: segment.confidence, visuallyUncertain: true,
      options: [{ char: text, reason: "Original OCR transcription" },
        ...alternatives.map((char) => ({ char, reason: "Existing character suggestion" }))] });
  }
  return warnings;
}
