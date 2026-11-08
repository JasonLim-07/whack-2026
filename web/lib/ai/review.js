import { Buffer } from "node:buffer";
import { analyseGrammar, validateGrammarResponse } from "./grammar.js";
import { checkWritingCoverage, validBounds, validSpatialMetadata } from "./coverage.mjs";
import { hasLatinText, isLatinOnlyText, CHINESE_TEXT_MESSAGE } from "../review/text.mjs";

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

async function readBody(request, limit, tooLarge) {
  if (Number(request.headers.get("content-length")) > limit) throw tooLarge();
  if (!request.body) throw new Error("Missing body");
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > limit) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readConfirmedText(request) {
  let input;
  try {
    const bytes = await readBody(request, 64 * 1024, () =>
      new ReviewError(413, "TEXT_TOO_LARGE", "Confirmed text request must not exceed 64 KiB."));
    input = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    throw new ReviewError(400, "INVALID_REQUEST", "Unable to read confirmed text JSON.");
  }
  if (!input || Array.isArray(input) || typeof input !== "object" ||
      typeof input.text !== "string" || !input.text.trim()) {
    throw new ReviewError(400, "INVALID_TEXT", "Confirmed text must be a non-empty string.");
  }
  const { text, level = "beginner", revision = null } = input;
  if (isLatinOnlyText(text)) throw new ReviewError(400, "EXPECTED_CHINESE_TEXT", CHINESE_TEXT_MESSAGE);
  if (typeof level !== "string" || !level.trim()) {
    throw new ReviewError(400, "INVALID_LEVEL", "Level must be a non-empty string.");
  }
  if (Object.hasOwn(input, "revision") && (!Number.isSafeInteger(input.revision) || input.revision < 0)) {
    throw new ReviewError(400, "INVALID_REVISION", "Revision must be a non-negative safe integer.");
  }
  return { text, level, revision };
}

async function readReviewRequest(request) {
  const contentType = request.headers.get("content-type") || "";
  if (/^application\/json\s*(?:;|$)/i.test(contentType)) return readConfirmedText(request);
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new ReviewError(400, "INVALID_REQUEST", "Expected multipart/form-data with a PNG image.");
  }

  const tooLarge = () => new ReviewError(413, "IMAGE_TOO_LARGE", "Image must not exceed 5 MB; multipart overhead is limited to 64 KiB.");
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) {
    throw tooLarge();
  }

  let form;
  try {
    form = await new Response(await readBody(request, MAX_REQUEST_BYTES, tooLarge), {
      headers: { "content-type": contentType },
    }).formData();
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    throw new ReviewError(400, "INVALID_REQUEST", "Unable to read multipart form data.");
  }

  for (const field of ["image", "level", "revision", "spatial"]) {
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

  let spatial;
  if (form.has("spatial")) {
    try {
      const value = form.get("spatial");
      if (typeof value !== "string" || Buffer.byteLength(value) > 48 * 1024) throw new Error("Invalid metadata");
      spatial = JSON.parse(value);
      if (!validSpatialMetadata(spatial) || imageBuffer.length < 24 ||
        imageBuffer.toString("ascii", 12, 16) !== "IHDR" ||
        imageBuffer.readUInt32BE(16) !== spatial.width || imageBuffer.readUInt32BE(20) !== spatial.height) throw new Error("Invalid regions");
    } catch {
      throw new ReviewError(400, "INVALID_SPATIAL_METADATA", "Writing regions must match the uploaded PNG. Please review your writing again.");
    }
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
  return { imageBuffer, level, revision, ...(spatial ? { spatial } : {}) };
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

async function reviewText(text, level, revision, grammar, confidence = null, segments = []) {
  let analysis;
  try {
    analysis = validateGrammarResponse(await grammar(text, { level }), text);
  } catch (error) {
    throw providerError(error, "GRAMMAR");
  }
  return {
    recognizedText: text,
    ocrConfidence: confidence,
    ocrSegments: segments,
    correctedText: analysis.correctedText,
    issues: analysis.issues,
    revision,
  };
}

/** Orchestrate already-validated input; dependencies are injected only by server code. */
export async function reviewHandwriting(
  { imageBuffer, level = "beginner", revision = null, spatial },
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
  if (!recognition || typeof recognition.text !== "string" ||
    (!recognition.text.trim() && !spatial && recognition.status !== "UNREADABLE")) {
    throw new ReviewError(400, "UNREADABLE_TEXT", "No readable handwriting text was recognised.");
  }
  if (!validConfidence(recognition.confidence) || !Array.isArray(recognition.segments)) {
    throw new ReviewError(502, "INVALID_OCR_RESPONSE", "Recognition provider returned invalid confidence data.");
  }
  const segments = Array.from(recognition.segments, (segment) => {
    if (!segment || typeof segment.text !== "string" || !validConfidence(segment.confidence) ||
      (segment.bounds !== undefined && !validBounds(segment.bounds))) {
      throw new ReviewError(502, "INVALID_OCR_RESPONSE", "Recognition provider returned invalid segment data.");
    }
    return { text: segment.text, confidence: segment.confidence, ...(segment.bounds ? { bounds: segment.bounds } : {}) };
  });

  const coverage = checkWritingCoverage(spatial, segments);
  const unexpectedLatin = hasLatinText(recognition.text);
  const intentTargets = [];
  // Latin spans may be misrecognitions. Keep them untouched until confirmed.
  for (const match of recognition.text.matchAll(/\p{Script=Latin}[\p{Script=Latin}\p{Mark}]*/gu)) {
    const start = Array.from(recognition.text.slice(0, match.index)).length;
    intentTargets.push({ id: `intent:${start}`, start, end: start + Array.from(match[0]).length, original: match[0] });
  }
  let offset = 0;
  for (const segment of segments) {
    const start = offset;
    offset += Array.from(segment.text).length;
    if (segment.confidence !== null && segment.confidence < 0.60 &&
      !intentTargets.some((target) => target.start < offset && target.end > start)) {
      intentTargets.push({ id: `intent:${start}`, start, end: offset, original: segment.text });
    }
  }
  if (recognition.status === "UNREADABLE" && !intentTargets.length && !coverage?.intentTargets.length) {
    intentTargets.push({ id: "intent:whole", start: 0, end: Array.from(recognition.text).length, original: recognition.text });
  }
  intentTargets.push(...(coverage?.intentTargets ?? []));
  intentTargets.sort((a, b) => a.start - b.start || a.end - b.end);
  const unalignedText = segments.map((segment) => segment.text).join("") !== recognition.text;
  const ambiguous = coverage?.ambiguousOrdering || (intentTargets.length > 0 && unalignedText && (segments.length > 0 || coverage));
  if (coverage || unexpectedLatin || intentTargets.length) {
    const candidates = (recognition.characterCandidates ?? []).filter((candidate) =>
      !intentTargets.some((target) => candidate.position >= target.start && candidate.position < target.end));
    return {
      status: "LOW_CONFIDENCE", requiresVerification: true,
      ...(ambiguous ? { requiresTextConfirmation: true } : {}),
      recognizedText: recognition.text, ocrConfidence: recognition.confidence, ocrSegments: segments,
      characterCandidates: ambiguous ? [] : candidates,
      intentTargets: ambiguous ? [] : intentTargets,
      unresolvedRegions: coverage?.unresolvedRegions ?? [],
      clarificationMessage: ambiguous ? "Please check the sentence and its order."
        : "What did you mean to write? Tell us in English.",
      revision,
    };
  }

  if (recognition.status === "LOW_CONFIDENCE" || recognition.requiresVerification === true) {
    return {
      status: "LOW_CONFIDENCE",
      recognizedText: recognition.text,
      ocrConfidence: recognition.confidence,
      ocrSegments: segments,
      requiresVerification: true,
      characterCandidates: recognition.characterCandidates,
      revision,
    };
  }
  return reviewText(recognition.text, level, revision, grammar, recognition.confidence, segments);
}

/** Shared request handler; the normal route supplies no mock OCR dependency. */
export async function handleReview(request, dependencies = {}) {
  try {
    const input = await readReviewRequest(request);
    const review = Object.hasOwn(input, "text")
      ? await reviewText(input.text, input.level, input.revision, dependencies.analyseGrammar || analyseGrammar)
      : await reviewHandwriting(input, dependencies);
    return Response.json(review);
  } catch (error) {
    if (error instanceof ReviewError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return Response.json({ error: { code: "INTERNAL_ERROR", message: "Unable to review handwriting." } }, { status: 500 });
  }
}
