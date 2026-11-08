import crypto from "node:crypto";
import {
  clusterStrokesIntoCharacters,
  normalizeImageInput,
  renderStrokesToPng,
} from "./pngUtils.js";

const DEFAULT_MODEL = process.env.GEMINI_OCR_MODEL || "gemini-2.5-flash";
const DEFAULT_PROVIDER = process.env.OCR_PROVIDER || "auto"; // "vision", "gemini", or "auto"
const DEFAULT_UNCERTAINTY_THRESHOLD = 0.8;
const MAX_CACHE_ENTRIES = 50;
const transcriptionCache = new Map();

const LITERAL_OCR_SYSTEM_PROMPT = `You are a strict optical character recognition (OCR) engine for handwritten Chinese on a learner's digital whiteboard.

CRITICAL RULES:
1. Transcribe ONLY the exact characters physically written in the image, in left-to-right, top-to-bottom reading order.
2. NEVER fix grammar, NEVER reorder characters, and NEVER insert missing words or measure words.
   - Example: If the learner writes "我有三书。", you MUST output "我有三书。" — NEVER change it to "我有三本书。".
   - Example: If the learner writes "我你爱。", you MUST output "我你爱。" — NEVER reorder it to "我爱你。".
3. Extract each visible handwritten character or punctuation mark one slot at a time in the "characters" array FIRST. The "transcription" string must be the exact concatenation of those character slots.
4. If a character is written messily, with shaky mouse strokes, uneven radical spacing, or a slightly missing/deformed stroke, still identify the character the learner wrote, lower its "confidence" score accordingly (e.g. 0.45–0.80), and describe the visual handwriting issue briefly in "formNote".
5. For each character, provide "box2d" as [ymin, xmin, ymax, xmax] normalized to 0..1000 relative to the image dimensions.`;

const OCR_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    characters: {
      type: "ARRAY",
      description:
        "Ordered list of every physical character or punctuation mark visible in the handwriting image.",
      items: {
        type: "OBJECT",
        properties: {
          character: {
            type: "STRING",
            description:
              "The single Chinese character or punctuation mark at this position.",
          },
          confidence: {
            type: "NUMBER",
            description: "Recognition confidence from 0.0 to 1.0.",
          },
          box2d: {
            type: "ARRAY",
            description:
              "Bounding box [ymin, xmin, ymax, xmax] normalized from 0 to 1000.",
            items: { type: "INTEGER" },
          },
          formNote: {
            type: "STRING",
            description:
              "Optional short note if the character strokes are messy, incomplete, or malformed (empty string if neat).",
          },
        },
        required: ["character", "confidence"],
      },
    },
    transcription: {
      type: "STRING",
      description:
        "Literal concatenation of the recognized characters in reading order, preserving all learner mistakes.",
    },
    overallConfidence: {
      type: "NUMBER",
      description: "Overall confidence score from 0.0 to 1.0.",
    },
  },
  required: ["characters", "transcription", "overallConfidence"],
};

function getApiKey(options = {}) {
  return (
    options.apiKey ||
    process.env.GOOGLE_CLOUD_VISION_API_KEY ||
    process.env.GOOGLE_VISION_API_KEY ||
    process.env.GEMINI_OCR_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  );
}

function getCacheKey(base64, language, provider, model, uncertaintyThreshold) {
  return crypto
    .createHash("sha256")
    .update(
      `${provider}:${model}:${language}:${uncertaintyThreshold}:${base64}`
    )
    .digest("hex");
}

/**
 * Parses a confidence score in [0, 1] without fabricating values when missing.
 * Returns null if the provider did not supply a numeric confidence score.
 */
export function parseConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/**
 * Converts Google Cloud Vision boundingPoly vertices [{x, y}, ...] into { x, y, width, height }.
 */
function verticesToBounds(vertices) {
  if (!Array.isArray(vertices) || vertices.length === 0) {
    return undefined;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const v of vertices) {
    const vx = typeof v?.x === "number" ? v.x : 0;
    const vy = typeof v?.y === "number" ? v.y : 0;
    if (vx < minX) minX = vx;
    if (vy < minY) minY = vy;
    if (vx > maxX) maxX = vx;
    if (vy > maxY) maxY = vy;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return undefined;
  }

  return {
    x: Math.max(0, Math.round(minX)),
    y: Math.max(0, Math.round(minY)),
    width: Math.max(4, Math.round(maxX - minX)),
    height: Math.max(4, Math.round(maxY - minY)),
  };
}

/**
 * Converts Gemini's [ymin, xmin, ymax, xmax] (0..1000) into canvas pixel bounds.
 */
function box2dToBounds(box2d, canvasWidth, canvasHeight) {
  if (!Array.isArray(box2d) || box2d.length < 4) {
    return undefined;
  }
  const [ymin, xmin, ymax, xmax] = box2d;
  if (
    typeof ymin !== "number" ||
    typeof xmin !== "number" ||
    typeof ymax !== "number" ||
    typeof xmax !== "number"
  ) {
    return undefined;
  }

  const w = canvasWidth || 800;
  const h = canvasHeight || 400;
  const x = Math.max(0, Math.round((xmin / 1000) * w));
  const y = Math.max(0, Math.round((ymin / 1000) * h));
  const width = Math.max(4, Math.round(((xmax - xmin) / 1000) * w));
  const height = Math.max(4, Math.round(((ymax - ymin) / 1000) * h));

  return { x, y, width, height };
}

/**
 * Resolves flexible caller inputs into a normalized image + optional stroke metadata.
 */
export function prepareRecognitionInput(input) {
  if (!input) {
    const err = new Error("Missing handwriting input for recognition.");
    err.code = "INVALID_INPUT";
    err.status = 400;
    throw err;
  }

  if (
    typeof input === "string" ||
    Buffer.isBuffer(input) ||
    input instanceof Uint8Array
  ) {
    const image = normalizeImageInput(input);
    return {
      image,
      strokes: [],
      canvas: { width: 800, height: 400 },
      language: "zh",
    };
  }

  if (typeof input === "object") {
    const writing = input.writing || input;
    const strokes = Array.isArray(writing.strokes)
      ? writing.strokes
      : Array.isArray(input.strokes)
        ? input.strokes
        : [];
    const canvas = writing.canvas || input.canvas || { width: 800, height: 400 };
    const language = input.language || "zh";

    const rawImage =
      input.image ||
      input.imageBase64 ||
      input.png ||
      input.dataUrl ||
      writing.image ||
      writing.imageBase64;

    if (rawImage) {
      const image = normalizeImageInput(rawImage);
      return { image, strokes, canvas, language };
    }

    if (strokes.length > 0) {
      const rendered = renderStrokesToPng(strokes);
      return {
        image: {
          base64: rendered.base64,
          mimeType: "image/png",
          buffer: rendered.buffer,
        },
        strokes,
        canvas: {
          width: canvas.width || rendered.width,
          height: canvas.height || rendered.height,
        },
        language,
      };
    }

    const err = new Error(
      "Handwriting input must include a PNG image or non-empty strokes."
    );
    err.code = "EMPTY_HANDWRITING";
    err.status = 400;
    throw err;
  }

  const err = new Error("Unsupported handwriting input type.");
  err.code = "INVALID_INPUT";
  err.status = 400;
  throw err;
}

/**
 * Calls Google Cloud Vision API (DOCUMENT_TEXT_DETECTION with Chinese handwriting hints).
 * Extracts per-symbol characters, genuine provider confidence scores (or null), and pixel bounding boxes.
 */
export async function callCloudVisionOcr({
  base64,
  language = "zh",
  apiKey,
  fetchImpl = fetch,
}) {
  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(
    apiKey
  )}`;

  const languageHints =
    language === "zh"
      ? ["zh-t-i0-handwrit", "zh", "zh-Hans", "zh-Hant"]
      : [language];

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints },
        },
      ],
    }),
  });

  if (!response.ok) {
    const status = response.status;
    let detail = "";
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || "";
    } catch {
      // Ignore parse error
    }
    const err = new Error(
      status === 429
        ? "Cloud Vision rate limit reached. Please wait a moment and try again."
        : `Google Cloud Vision API returned HTTP ${status}${detail ? `: ${detail}` : ""}.`
    );
    err.code = status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
    err.status = status === 429 ? 429 : 502;
    throw err;
  }

  const payload = await response.json();
  if (!Array.isArray(payload?.responses)) {
    const err = new Error("Unexpected Cloud Vision response payload.");
    err.code = "PROVIDER_ERROR";
    err.status = 502;
    throw err;
  }
  const firstResponse = payload.responses[0] || {};

  if (firstResponse.error) {
    const err = new Error(
      `Google Cloud Vision error: ${firstResponse.error.message || "Unknown error"}`
    );
    err.code = "PROVIDER_ERROR";
    err.status = 502;
    throw err;
  }

  const fullText = firstResponse.fullTextAnnotation;
  if (!fullText) {
    return {
      provider: "google-cloud-vision",
      characters: [],
      transcription: "",
      overallConfidence: null,
    };
  }

  const characters = [];
  const pages = Array.isArray(fullText.pages) ? fullText.pages : [];

  for (const page of pages) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          for (const symbol of word.symbols || []) {
            const ch = (symbol.text || "").trim();
            if (!ch) continue;
            characters.push({
              character: ch,
              confidence: parseConfidence(symbol.confidence),
              bounds: verticesToBounds(symbol.boundingBox?.vertices),
            });
          }
        }
      }
    }
  }

  const transcription =
    characters.map((c) => c.character).join("") ||
    (fullText.text || "").replace(/\s+/g, "");

  const validConfidences = characters
    .map((c) => c.confidence)
    .filter((c) => typeof c === "number");

  const overallConfidence =
    validConfidences.length > 0
      ? validConfidences.reduce((sum, c) => sum + c, 0) / validConfidences.length
      : null;

  return {
    provider: "google-cloud-vision",
    characters,
    transcription,
    overallConfidence,
  };
}

/**
 * Calls Google AI Studio / Gemini Vision API to perform literal Chinese handwriting OCR.
 */
export async function callGeminiVisionOcr({
  base64,
  mimeType,
  strokeClusters,
  language,
  model,
  apiKey,
  fetchImpl = fetch,
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const clusterHint =
    strokeClusters.length > 0
      ? `\nDetected ${strokeClusters.length} distinct stroke cluster(s) on the canvas from left to right. Do not invent extra characters beyond what is visibly written.`
      : "";

  const userPrompt = `Perform literal handwriting OCR on this ${
    language === "zh" ? "Chinese" : language
  } whiteboard image.${clusterHint}
Return each physical character in reading order inside "characters", and the exact concatenated text in "transcription" without correcting any grammar or character mistakes.`;

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: LITERAL_OCR_SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: mimeType || "image/png",
                data: base64,
              },
            },
            { text: userPrompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: OCR_RESPONSE_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    let detail = "";
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || "";
    } catch {
      // Ignore parse error
    }
    const err = new Error(
      status === 429
        ? "Recognition rate limit reached. Please wait a moment and try again."
        : `Gemini API returned HTTP ${status}${detail ? `: ${detail}` : ""}.`
    );
    err.code = status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
    err.status = status === 429 ? 429 : 502;
    throw err;
  }

  const payload = await response.json();
  const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!rawText) {
    const err = new Error("Recognition model returned an empty response.");
    err.code = "PROVIDER_ERROR";
    err.status = 502;
    throw err;
  }

  try {
    const parsed = JSON.parse(rawText);
    return {
      ...parsed,
      provider: "gemini-vision",
    };
  } catch {
    const err = new Error("Failed to parse JSON from recognition model.");
    err.code = "PROVIDER_ERROR";
    err.status = 502;
    throw err;
  }
}

const CJK_CHAR_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const DIGIT_REGEX = /^[0-9]$/;
const ASCII_ALNUM_REGEX = /^[0-9A-Za-z]$/;

/**
 * Checks whether an ASCII punctuation mark at index `idx` should be normalized to full-width
 * Chinese punctuation based on its immediate neighbors.
 * Prevents corrupting decimals ("3.5"), thousands ("1,000"), ellipses ("..."), or English text.
 */
function normalizeContextualChinesePunctuation(charText, idx, filteredRawChars) {
  const prevChar = idx > 0 ? filteredRawChars[idx - 1].character.trim() : "";
  const nextChar =
    idx + 1 < filteredRawChars.length
      ? filteredRawChars[idx + 1].character.trim()
      : "";

  // Never normalize "." or "," when adjacent to digits on both sides (e.g. "3.5", "1,000")
  if (
    (charText === "." || charText === ",") &&
    DIGIT_REGEX.test(prevChar) &&
    DIGIT_REGEX.test(nextChar)
  ) {
    return charText;
  }

  // Never normalize consecutive periods ("..." ellipsis)
  if (charText === "." && (prevChar === "." || nextChar === ".")) {
    return charText;
  }

  // Only normalize if adjacent to a Chinese character (or Chinese punctuation)
  const hasCjkNeighbor =
    CJK_CHAR_REGEX.test(prevChar) || CJK_CHAR_REGEX.test(nextChar);
  if (!hasCjkNeighbor) {
    return charText;
  }

  if (charText === ".") return "。";
  if (charText === ",") return "，";
  if (charText === "?") return "？";
  if (charText === "!") return "！";
  return charText;
}

/**
 * Decides whether a recognized "0" or "O" has strong supporting evidence to be disambiguated to "口":
 * 1. Exact 1-to-1 alignment between strokeClusters and recognized symbols (so stroke count is reliable).
 * 2. Cluster has 3 or 4 strokes (Arabic 0 / letter O is written in 1 loop; Chinese 口 has 3 strokes).
 * 3. Cluster bounding box has roughly square proportions (aspect ratio between 0.55 and 1.65).
 * 4. Immediate neighbors include Chinese characters and NO adjacent digits or Latin letters
 *    (so "10", "100", "2026", "OK", "H2O" are never altered).
 * 5. Provider confidence on "0"/"O" is low (< 0.85) or missing.
 */
function shouldDisambiguateZeroToKou({
  charText,
  idx,
  filteredRawChars,
  matchedCluster,
  clustersAligned,
  providerConfidence,
}) {
  if (charText !== "0" && charText !== "O" && charText !== "o") {
    return false;
  }
  if (!clustersAligned || !matchedCluster) {
    return false;
  }

  const strokeCount = matchedCluster.strokeIds?.length ?? 0;
  if (strokeCount < 3 || strokeCount > 4) {
    return false;
  }

  const bounds = matchedCluster.bounds;
  if (bounds && bounds.height > 0) {
    const aspect = bounds.width / bounds.height;
    if (aspect < 0.55 || aspect > 1.65) {
      return false;
    }
  }

  // If the OCR provider is highly confident (>= 0.85) that it is a "0", trust the provider
  if (typeof providerConfidence === "number" && providerConfidence >= 0.85) {
    return false;
  }

  const prevChar = idx > 0 ? filteredRawChars[idx - 1].character.trim() : "";
  const nextChar =
    idx + 1 < filteredRawChars.length
      ? filteredRawChars[idx + 1].character.trim()
      : "";

  // Never convert if adjacent to digits or Latin letters (e.g. "10个人", "2026年", "HSK0")
  if (ASCII_ALNUM_REGEX.test(prevChar) || ASCII_ALNUM_REGEX.test(nextChar)) {
    return false;
  }

  // Require at least one immediate CJK neighbor
  return CJK_CHAR_REGEX.test(prevChar) || CJK_CHAR_REGEX.test(nextChar);
}

/**
 * Normalizes the raw model output and pairs recognized characters with stroke clusters / bounds.
 * Preserves original provider characters, original transcription, and genuine confidence scores (null if absent).
 */
export function normalizeOcrResult(
  rawModelResult,
  {
    strokeClusters = [],
    canvas = { width: 800, height: 400 },
    language = "zh",
    uncertaintyThreshold = DEFAULT_UNCERTAINTY_THRESHOLD,
    provider = rawModelResult?.provider || "google-cloud-vision",
  } = {}
) {
  const rawChars = Array.isArray(rawModelResult?.characters)
    ? rawModelResult.characters
    : [];

  const filteredRawChars = rawChars.filter(
    (item) =>
      typeof item?.character === "string" && item.character.trim().length > 0
  );

  const hasChineseChar = filteredRawChars.some((item) =>
    CJK_CHAR_REGEX.test(item.character)
  );

  // Stroke cluster counts are only guaranteed 1-to-1 with OCR symbols when lengths match
  const clustersAligned =
    strokeClusters.length > 0 &&
    strokeClusters.length === filteredRawChars.length;

  const uncertainCharacters = [];

  const characters = filteredRawChars.map((item, idx) => {
    const originalCharacter = item.character.trim();
    let charText = originalCharacter;

    const matchedCluster = clustersAligned ? strokeClusters[idx] : null;
    const confidence = parseConfidence(item.confidence);
    let postProcessingReason = null;

    if (language === "zh" && hasChineseChar) {
      const punctNormalized = normalizeContextualChinesePunctuation(
        charText,
        idx,
        filteredRawChars
      );
      if (punctNormalized !== charText) {
        charText = punctNormalized;
        postProcessingReason = "punctuation_normalized";
      } else if (
        shouldDisambiguateZeroToKou({
          charText,
          idx,
          filteredRawChars,
          matchedCluster,
          clustersAligned,
          providerConfidence: confidence,
        })
      ) {
        charText = "口";
        postProcessingReason = "disambiguated_zero_to_kou";
      }
    }

    const bounds =
      item.bounds ||
      matchedCluster?.bounds ||
      box2dToBounds(item.box2d, canvas.width, canvas.height);

    const lowConfidence =
      confidence === null || confidence < uncertaintyThreshold;
    const wasDisambiguated =
      postProcessingReason === "disambiguated_zero_to_kou";
    const hasFormIssue = Boolean(
      typeof item.formNote === "string" && item.formNote.trim()
    );
    const uncertain = Boolean(
      lowConfidence || wasDisambiguated || hasFormIssue
    );

    const entry = {
      character: charText,
      originalCharacter,
      confidence,
      uncertain,
    };

    if (postProcessingReason) {
      entry.normalized = true;
      entry.normalizationReason = postProcessingReason;
    }
    if (bounds) {
      entry.bounds = bounds;
    }
    if (matchedCluster?.strokeIds?.length) {
      entry.strokeIds = matchedCluster.strokeIds;
    }
    if (hasFormIssue) {
      entry.formNote = item.formNote.trim();
    }

    if (uncertain) {
      let reason = "low_confidence";
      if (confidence === null) reason = "missing_confidence";
      else if (wasDisambiguated) reason = "disambiguated_from_zero";
      else if (hasFormIssue) reason = "form_note";

      uncertainCharacters.push({
        index: idx,
        character: charText,
        originalCharacter,
        confidence,
        reason,
      });
    }

    return entry;
  });

  const originalSlotText = characters.map((c) => c.originalCharacter).join("");
  const slotTranscription = characters.map((c) => c.character).join("");

  const originalText =
    originalSlotText ||
    (typeof rawModelResult?.transcription === "string"
      ? rawModelResult.transcription.trim()
      : "");

  const text =
    slotTranscription ||
    (typeof rawModelResult?.transcription === "string"
      ? rawModelResult.transcription.trim()
      : "");

  const numericConfidences = characters
    .map((c) => c.confidence)
    .filter((c) => typeof c === "number");

  let overallConfidence = parseConfidence(rawModelResult?.overallConfidence);
  if (numericConfidences.length > 0) {
    const avg =
      numericConfidences.reduce((sum, c) => sum + c, 0) /
      numericConfidences.length;
    overallConfidence = parseConfidence(avg);
  } else if (characters.length === 0) {
    overallConfidence = 0;
  }

  return {
    success: true,
    text,
    originalText,
    transcription: text,
    language,
    confidence: overallConfidence,
    provider,
    characters,
    uncertainCharacters,
  };
}

/**
 * Main handwriting recognition function.
 * Supports both Google Cloud Vision API (DOCUMENT_TEXT_DETECTION with zh-t-i0-handwrit)
 * and Gemini Vision API, returning literal Chinese transcription + character-level metadata.
 */
export async function transcribeHandwriting(input, options = {}) {
  const { image, strokes, canvas, language } = prepareRecognitionInput(input);
  const strokeClusters = clusterStrokesIntoCharacters(strokes);
  const model = options.model || DEFAULT_MODEL;
  const provider = (options.provider || DEFAULT_PROVIDER).toLowerCase();
  const uncertaintyThreshold =
    typeof options.uncertaintyThreshold === "number"
      ? options.uncertaintyThreshold
      : DEFAULT_UNCERTAINTY_THRESHOLD;

  // Support explicit mock responses for unit tests or offline UI development
  if (options.mockResult) {
    return normalizeOcrResult(options.mockResult, {
      strokeClusters,
      canvas,
      language,
      uncertaintyThreshold,
      provider: options.mockResult.provider || "mock",
    });
  }

  const cacheKey = getCacheKey(
    image.base64,
    language,
    provider,
    model,
    uncertaintyThreshold
  );
  if (!options.skipCache && transcriptionCache.has(cacheKey)) {
    return transcriptionCache.get(cacheKey);
  }

  const apiKey = getApiKey(options);
  if (!apiKey) {
    const err = new Error(
      "Missing Google API key. Set GEMINI_OCR_API_KEY or GOOGLE_CLOUD_VISION_API_KEY in web/.env.local."
    );
    err.code = "MISSING_API_KEY";
    err.status = 500;
    throw err;
  }

  let rawModelResult;

  if (provider === "vision" || provider === "cloud-vision") {
    rawModelResult = await callCloudVisionOcr({
      base64: image.base64,
      language,
      apiKey,
      fetchImpl: options.fetchImpl,
    });
  } else if (provider === "gemini") {
    rawModelResult = await callGeminiVisionOcr({
      base64: image.base64,
      mimeType: image.mimeType,
      strokeClusters,
      language,
      model,
      apiKey,
      fetchImpl: options.fetchImpl,
    });
  } else {
    // "auto": Try Google Cloud Vision API first, then fall back to Gemini Vision if configured
    try {
      rawModelResult = await callCloudVisionOcr({
        base64: image.base64,
        language,
        apiKey,
        fetchImpl: options.fetchImpl,
      });
    } catch (visionErr) {
      if (visionErr.status === 429) throw visionErr;
      try {
        rawModelResult = await callGeminiVisionOcr({
          base64: image.base64,
          mimeType: image.mimeType,
          strokeClusters,
          language,
          model,
          apiKey,
          fetchImpl: options.fetchImpl,
        });
      } catch {
        throw visionErr;
      }
    }
  }

  const result = normalizeOcrResult(rawModelResult, {
    strokeClusters,
    canvas,
    language,
    uncertaintyThreshold,
    provider: rawModelResult?.provider || "google-cloud-vision",
  });

  if (transcriptionCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = transcriptionCache.keys().next().value;
    transcriptionCache.delete(oldestKey);
  }
  transcriptionCache.set(cacheKey, result);

  return result;
}

export function clearTranscriptionCache() {
  transcriptionCache.clear();
}

export const transcribe = transcribeHandwriting;
export const recognizeHandwriting = transcribeHandwriting;
export const recogniseHandwriting = transcribeHandwriting;
export default transcribeHandwriting;
