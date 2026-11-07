import crypto from "node:crypto";
import {
  clusterStrokesIntoCharacters,
  normalizeImageInput,
  renderStrokesToPng,
} from "./pngUtils.js";

const DEFAULT_MODEL = process.env.GEMINI_OCR_MODEL || "gemini-2.5-flash";
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
            description: "The single Chinese character or punctuation mark at this position.",
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
    process.env.GEMINI_OCR_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  );
}

function getCacheKey(base64, language, model) {
  return crypto
    .createHash("sha256")
    .update(`${model}:${language}:${base64}`)
    .digest("hex");
}

function clampConfidence(value, fallback = 0.9) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
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
 * Accepts:
 *   - string (base64 or data:image/png;base64,...)
 *   - Buffer / Uint8Array
 *   - { image, imageBase64, png, writing, strokes, canvas, language }
 */
export function prepareRecognitionInput(input) {
  if (!input) {
    const err = new Error("Missing handwriting input for recognition.");
    err.code = "INVALID_INPUT";
    err.status = 400;
    throw err;
  }

  if (typeof input === "string" || Buffer.isBuffer(input) || input instanceof Uint8Array) {
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
 * Calls Google AI Studio (Gemini Vision API) to perform literal Chinese handwriting OCR.
 */
async function callGeminiVisionOcr({
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
    const err = new Error(
      status === 429
        ? "Recognition rate limit reached. Please wait a moment and try again."
        : `Recognition provider returned HTTP ${status}.`
    );
    err.code = status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR";
    err.status = status === 429 ? 429 : 502;
    throw err;
  }

  const payload = await response.json();
  const rawText =
    payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!rawText) {
    const err = new Error("Recognition model returned an empty response.");
    err.code = "PROVIDER_ERROR";
    err.status = 502;
    throw err;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    const err = new Error("Failed to parse JSON from recognition model.");
    err.code = "PROVIDER_ERROR";
    err.status = 502;
    throw err;
  }
}

/**
 * Normalizes the raw model output and pairs recognized characters with stroke clusters / bounds.
 */
export function normalizeOcrResult(
  rawModelResult,
  { strokeClusters = [], canvas = { width: 800, height: 400 }, language = "zh" } = {}
) {
  const rawChars = Array.isArray(rawModelResult?.characters)
    ? rawModelResult.characters
    : [];

  const characters = rawChars
    .filter((item) => typeof item?.character === "string" && item.character.trim().length > 0)
    .map((item, idx) => {
      const charText = item.character.trim();
      const confidence = clampConfidence(item.confidence, 0.9);
      const matchedCluster =
        strokeClusters.length === rawChars.length
          ? strokeClusters[idx]
          : strokeClusters[idx] || null;

      const bounds =
        matchedCluster?.bounds ||
        box2dToBounds(item.box2d, canvas.width, canvas.height);

      const entry = {
        character: charText,
        confidence,
      };

      if (bounds) {
        entry.bounds = bounds;
      }
      if (matchedCluster?.strokeIds?.length) {
        entry.strokeIds = matchedCluster.strokeIds;
      }
      if (typeof item.formNote === "string" && item.formNote.trim()) {
        entry.formNote = item.formNote.trim();
      }

      return entry;
    });

  // Always build the literal transcription from the extracted character slots first
  // so the model cannot silently insert a missing word in the sentence string.
  const slotTranscription = characters.map((c) => c.character).join("");
  const transcription =
    slotTranscription ||
    (typeof rawModelResult?.transcription === "string"
      ? rawModelResult.transcription.trim()
      : "");

  const avgConfidence =
    characters.length > 0
      ? characters.reduce((sum, c) => sum + c.confidence, 0) / characters.length
      : rawModelResult?.overallConfidence ?? 0;

  return {
    success: true,
    transcription,
    language,
    confidence: clampConfidence(
      rawModelResult?.overallConfidence ?? avgConfidence,
      clampConfidence(avgConfidence, 0)
    ),
    characters,
  };
}

/**
 * Main handwriting recognition function.
 * Accepts a PNG image (base64, data URL, or Buffer) or a handwriting snapshot object,
 * and returns the literal Chinese transcription + character-level metadata.
 */
export async function transcribeHandwriting(input, options = {}) {
  const { image, strokes, canvas, language } = prepareRecognitionInput(input);
  const strokeClusters = clusterStrokesIntoCharacters(strokes);
  const model = options.model || DEFAULT_MODEL;

  // Support explicit mock responses for unit tests or offline UI development
  if (options.mockResult) {
    return normalizeOcrResult(options.mockResult, {
      strokeClusters,
      canvas,
      language,
    });
  }

  const cacheKey = getCacheKey(image.base64, language, model);
  if (!options.skipCache && transcriptionCache.has(cacheKey)) {
    return transcriptionCache.get(cacheKey);
  }

  const apiKey = getApiKey(options);
  if (!apiKey) {
    const err = new Error(
      "Missing Google AI Studio API key. Set GEMINI_OCR_API_KEY or GEMINI_API_KEY in web/.env.local."
    );
    err.code = "MISSING_API_KEY";
    err.status = 500;
    throw err;
  }

  const rawModelResult = await callGeminiVisionOcr({
    base64: image.base64,
    mimeType: image.mimeType,
    strokeClusters,
    language,
    model,
    apiKey,
    fetchImpl: options.fetchImpl,
  });

  const result = normalizeOcrResult(rawModelResult, {
    strokeClusters,
    canvas,
    language,
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
export default transcribeHandwriting;
