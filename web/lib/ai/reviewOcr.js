import { Buffer } from "node:buffer";
import { recogniseHandwriting as transcribeHandwriting } from "./ocr.js";
import { validBounds } from "../review/locations.mjs";

export function readPngDimensions(imageBuffer) {
  const bytes = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) ||
    bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new TypeError("Review OCR requires a PNG with a valid dimension header.");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height) throw new TypeError("Invalid PNG dimensions.");
  return { width, height };
}

function characterLocations(result, dimensions) {
  if (!Array.isArray(result.characters)) return [];
  if (result.characters.some((character) => typeof character?.originalCharacter !== "string" || !character.originalCharacter) ||
    result.characters.map((character) => character.originalCharacter).join("") !== result.originalText) return [];
  let cursor = 0;
  return result.characters.map((character) => {
    const text = character.originalCharacter;
    const start = cursor;
    cursor += Array.from(text).length;
    let bounds = validBounds(character.bounds) ? character.bounds ?? null : null;
    if (bounds && dimensions) {
      // Provider rounding can extend slightly beyond an image edge.
      const width = Math.min(bounds.width, dimensions.width - bounds.x);
      const height = Math.min(bounds.height, dimensions.height - bounds.y);
      bounds = width > 0 && height > 0 ? { ...bounds, width, height } : null;
    }
    return { text, start, end: cursor, bounds };
  });
}

/** Preserve original OCR text and pixel geometry, without normalised corrections. */
export function normaliseReviewOcrResult(result, dimensions) {
  if (!["SUCCESS", "LOW_CONFIDENCE", "UNREADABLE"].includes(result?.status) ||
      typeof result.text !== "string" || !Array.isArray(result.characterCandidates)) {
    throw new Error("Recognition provider returned an invalid transcription result.");
  }
  return {
    text: result.originalText ?? result.text,
    status: result.status,
    requiresVerification: result.requiresVerification,
    characterCandidates: result.characterCandidates,
    // The overall OCR score is derived, and Gemini scores are self-ratings.
    // Only Cloud Vision's reported segment scores are exposed as confidence.
    confidence: null,
    segments: (result.characters || []).map((character) => ({
      text: character.originalCharacter,
      confidence: result.provider === "google-cloud-vision" ? character.confidence : null,
      ...(character.bounds ? { bounds: character.bounds } : {}),
    })),
    characters: characterLocations(result, dimensions),
  };
}

export async function recogniseHandwriting(imageBuffer, mimeType = "image/png") {
  if (mimeType !== "image/png") throw new TypeError("Review OCR requires a PNG image.");
  const dimensions = readPngDimensions(imageBuffer);
  // Explicit dimensions prevent Gemini boxes being scaled against the 800x400 fallback.
  const result = await transcribeHandwriting({ image: imageBuffer, canvas: dimensions }, { skipCache: true });
  return normaliseReviewOcrResult(result, dimensions);
}
