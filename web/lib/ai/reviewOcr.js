import { recogniseHandwriting as transcribeHandwriting } from "./ocr.js";

/** Adapt Johan's richer OCR result without passing normalized text to grammar. */
export function normaliseReviewOcrResult(result) {
  if (!["SUCCESS", "LOW_CONFIDENCE", "UNREADABLE"].includes(result?.status) ||
      typeof result.text !== "string" || !Array.isArray(result.characterCandidates)) {
    throw new Error("Recognition provider returned an invalid transcription result.");
  }
  return {
    text: result.originalText ?? result.text,
    status: result.status,
    requiresVerification: result.requiresVerification,
    characterCandidates: result.characterCandidates,
    // Johan's overall score is derived from character scores, not reported for
    // the whole text. Gemini's generated confidence numbers are self-ratings.
    confidence: null,
    segments: (result.characters || []).map((character) => ({
      text: character.originalCharacter,
      confidence: result.provider === "google-cloud-vision" ? character.confidence : null,
      ...(character.bounds ? { bounds: character.bounds } : {}),
    })),
  };
}

/** Contract used by review.js; OCR's second argument is options, not MIME type. */
export async function recogniseHandwriting(imageBuffer, mimeType = "image/png") {
  if (mimeType !== "image/png") throw new TypeError("Review OCR requires a PNG image.");
  // Preserve the configured provider/model and keep MIME out of OCR's options.
  const result = await transcribeHandwriting(imageBuffer);
  return normaliseReviewOcrResult(result);
}
