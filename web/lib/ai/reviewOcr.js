import { recogniseHandwriting as transcribeHandwriting } from "./ocr.js";

/** Adapt Johan's richer OCR result without passing normalized text to grammar. */
export function normaliseReviewOcrResult(result) {
  if (result?.success !== true || typeof result.originalText !== "string" || !Array.isArray(result.characters)) {
    throw new Error("Recognition provider returned an invalid transcription result.");
  }
  return {
    text: result.originalText,
    // Johan's overall score is derived from character scores, not reported for
    // the whole text. Gemini's generated confidence numbers are self-ratings.
    confidence: null,
    segments: result.characters.map((character) => ({
      text: character.originalCharacter,
      confidence: result.provider === "google-cloud-vision" ? character.confidence : null,
    })),
  };
}

/** Contract used by review.js; OCR's second argument is options, not MIME type. */
export async function recogniseHandwriting(imageBuffer, mimeType = "image/png") {
  if (mimeType !== "image/png") throw new TypeError("Review OCR requires a PNG image.");
  // Preserve the configured provider/model; bypass existing cache reads so a
  // review performs recognition rather than reusing an earlier transcription.
  const result = await transcribeHandwriting(imageBuffer, { skipCache: true });
  return normaliseReviewOcrResult(result);
}
