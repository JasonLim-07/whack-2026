import { validOcrCharacters } from "../review/locations.mjs";
import { Buffer } from "node:buffer";
import { analyseGrammar, validateGrammarResponse } from "./grammar.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Bound the entire multipart body too, allowing 64 KiB for fields and headers.
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class ReviewError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readReviewRequest(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new ReviewError(400, "INVALID_REQUEST", "Expected multipart/form-data with a PNG image.");
  }

  const tooLarge = () => new ReviewError(413, "IMAGE_TOO_LARGE", "Image must not exceed 5 MB; multipart overhead is limited to 64 KiB.");
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) {
    throw tooLarge();
  }

  let form;
  try {
    const chunks = [];
    let size = 0;
    if (!request.body) throw new Error("Missing body");
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > MAX_REQUEST_BYTES) throw tooLarge();
      chunks.push(chunk);
    }
    form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": contentType },
    }).formData();
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    throw new ReviewError(400, "INVALID_REQUEST", "Unable to read multipart form data.");
  }

  for (const field of ["image", "level", "revision"]) {
    if (form.getAll(field).length > 1) {
      throw new ReviewError(400, "INVALID_REQUEST", `Provide ${field} only once.`);
    }
  }

  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) {
    throw new ReviewError(400, "INVALID_IMAGE", "A non-empty PNG image file is required.");
  }
  if (image.size > MAX_IMAGE_BYTES) throw tooLarge();
  if (image.type !== "image/png") {
    throw new ReviewError(400, "INVALID_IMAGE", "Image MIME type must be image/png.");
  }
  const imageBuffer = Buffer.from(await image.arrayBuffer());
  if (!imageBuffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new ReviewError(400, "INVALID_IMAGE", "Image does not have a valid PNG signature.");
  }

  const level = form.has("level") ? form.get("level") : "beginner";
  if (typeof level !== "string" || level.trim() === "") {
    throw new ReviewError(400, "INVALID_LEVEL", "Level must be a non-empty string.");
  }

  let revision = null;
  if (form.has("revision")) {
    const value = form.get("revision");
    if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new ReviewError(400, "INVALID_REVISION", "Revision must be a non-negative safe integer.");
    }
    revision = Number(value);
  }
  return { imageBuffer, level, revision };
}

function providerError(error, stage) {
  // Gemini currently exposes 429 through its safe message, not a status field.
  const rateLimited = error?.status === 429 || error?.statusCode === 429 ||
    (stage === "GRAMMAR" && typeof error?.message === "string" &&
      error.message.startsWith("Gemini rate limit or quota exceeded (HTTP 429)."));
  return rateLimited
    ? new ReviewError(429, "RATE_LIMITED", "Review provider rate limit exceeded. Try again later.")
    : new ReviewError(502, `${stage}_FAILED`, `${stage === "OCR" ? "Handwriting recognition" : "Grammar analysis"} failed. Please try again later.`);
}

function validConfidence(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

/** Orchestrate already-validated input; dependencies are injected only by server code. */
export async function reviewHandwriting(
  { imageBuffer, level = "beginner", revision = null },
  { recogniseHandwriting, analyseGrammar: grammar = analyseGrammar } = {},
) {
  if (typeof recogniseHandwriting !== "function") {
    throw new ReviewError(503, "OCR_UNAVAILABLE", "Handwriting recognition is not integrated yet.");
  }

  let recognition;
  try {
    recognition = await recogniseHandwriting(imageBuffer, "image/png");
  } catch (error) {
    throw providerError(error, "OCR");
  }
  if (!recognition || typeof recognition.text !== "string" || recognition.text.trim() === "") {
    throw new ReviewError(400, "UNREADABLE_TEXT", "No readable handwriting text was recognised.");
  }
  if (!validConfidence(recognition.confidence) || !Array.isArray(recognition.segments)) {
    throw new ReviewError(502, "INVALID_OCR_RESPONSE", "Recognition provider returned invalid confidence data.");
  }
  const segments = Array.from(recognition.segments, (segment) => {
    if (!segment || typeof segment.text !== "string" || !validConfidence(segment.confidence)) {
      throw new ReviewError(502, "INVALID_OCR_RESPONSE", "Recognition provider returned invalid segment data.");
    }
    return { text: segment.text, confidence: segment.confidence };
  });

  let analysis;
  try {
    analysis = validateGrammarResponse(await grammar(recognition.text, { level }), recognition.text);
  } catch (error) {
    throw providerError(error, "GRAMMAR");
  }
  const characters = recognition.characters ?? [];
  if (!validOcrCharacters(characters, recognition.text)) {
    throw new ReviewError(502, "INVALID_OCR_RESPONSE", "Recognition provider returned invalid character locations.");
  }
  return {
    ocrCharacters: characters,
    recognizedText: recognition.text,
    ocrConfidence: recognition.confidence,
    ocrSegments: segments,
    correctedText: analysis.correctedText,
    issues: analysis.issues,
    revision,
  };
}

/** Shared request handler; the normal route supplies no mock OCR dependency. */
export async function handleReview(request, dependencies = {}) {
  try {
    const input = await readReviewRequest(request);
    const review = await reviewHandwriting(input, dependencies);
    return Response.json(review);
  } catch (error) {
    if (error instanceof ReviewError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Unable to review handwriting." } }, { status: 500 });
  }
}
