import {
  callCloudVisionOcr,
  callGeminiVisionOcr,
  normalizeOcrResult,
  parseConfidence,
  prepareRecognitionInput,
} from "./transcribe.js";
import { clusterStrokesIntoCharacters } from "./pngUtils.js";
import {
  analyzeGrammar,
  evaluateStrokeDifference,
} from "../utils/ssim.js";

const HIGH_CONFIDENCE_THRESHOLD = 0.9;
const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Orthographic / stroke-structure similarity table for Chinese characters.
 * Maps a recognized character to visually/structurally similar characters
 * (differing by 1–2 strokes, radical enclosure, or stroke proportion).
 */
const VISUAL_SIMILARITY_MAP = {
  我: ["找", "成", "义"],
  找: ["我", "戈", "戏"],
  是: ["走", "定", "足"],
  走: ["是", "足", "赴"],
  学: ["字", "觉", "常"],
  字: ["学", "子", "宇"],
  生: ["牛", "主", "星"],
  牛: ["生", "午", "件"],
  有: ["右", "看", "月"],
  右: ["有", "石", "古"],
  三: ["二", "王", "川"],
  二: ["三", "一", "工"],
  一: ["二", "十", "厂"],
  书: ["本", "韦", "弗"],
  你: ["作", "他", "称"],
  作: ["你", "昨", "什"],
  爱: ["受", "友", "发"],
  受: ["爱", "授", "妥"],
  今: ["令", "合", "会"],
  令: ["今", "冷", "邻"],
  天: ["夫", "大", "夭"],
  夫: ["天", "大", "失"],
  去: ["云", "法", "丢"],
  云: ["去", "会", "运"],
  了: ["子", "才", "丁"],
  子: ["了", "字", "孑"],
  校: ["较", "效", "林"],
  中: ["申", "由", "口"],
  申: ["中", "由", "甲"],
  文: ["丈", "又", "支"],
  丈: ["文", "大", "杖"],
  人: ["入", "八", "个"],
  入: ["人", "八", "乂"],
  大: ["太", "天", "犬"],
  太: ["大", "犬", "天"],
  口: ["日", "囗", "中"],
  日: ["目", "口", "白"],
  目: ["日", "且", "自"],
  木: ["本", "未", "末"],
  本: ["木", "体", "未"],
  未: ["末", "本", "木"],
  末: ["未", "本", "木"],
  王: ["玉", "主", "工"],
  玉: ["王", "主", "五"],
  工: ["王", "土", "干"],
  不: ["下", "木", "还"],
  好: ["如", "她", "始"],
  吃: ["叱", "叶", "叫"],
  个: ["人", "介", "竹"],
  上: ["下", "土", "止"],
  下: ["上", "不", "丁"],
  小: ["少", "水", "八"],
  少: ["小", "步", "沙"],
  水: ["永", "小", "冰"],
  火: ["灭", "大", "伙"],
  土: ["士", "工", "王"],
  士: ["土", "干", "工"],
  干: ["千", "于", "土"],
  千: ["干", "十", "禾"],
  万: ["方", "力", "刀"],
  方: ["万", "放", "房"],
  力: ["刀", "万", "办"],
  刀: ["力", "刃", "刁"],
  已: ["己", "巳", "巴"],
  己: ["已", "巳", "记"],
  巳: ["已", "己", "巴"],
  白: ["百", "日", "自"],
  百: ["白", "日", "目"],
  自: ["白", "目", "日"],
  田: ["由", "甲", "申"],
  由: ["田", "甲", "申"],
  甲: ["由", "田", "申"],
  买: ["卖", "头", "实"],
  卖: ["买", "读", "续"],
  午: ["牛", "年", "千"],
  年: ["午", "牛", "手"],
  手: ["毛", "牛", "于"],
  毛: ["手", "尾", "屯"],
  看: ["着", "春", "有"],
  着: ["看", "差", "羊"],
  话: ["活", "说", "语"],
  说: ["话", "读", "悦"],
  语: ["悟", "话", "读"],
  读: ["卖", "续", "说"],
  写: ["与", "军", "冠"],
  国: ["固", "园", "回"],
  回: ["国", "口", "日"],
  来: ["米", "夹", "未"],
  米: ["来", "木", "采"],
  明: ["朋", "月", "萌"],
  朋: ["明", "月", "丽"],
  月: ["用", "同", "肉"],
  用: ["月", "同", "周"],
  同: ["用", "问", "向"],
  问: ["间", "门", "向"],
  间: ["问", "门", "闲"],
  门: ["们", "问", "间"],
  们: ["门", "什", "他"],
  他: ["她", "它", "地"],
  她: ["他", "好", "地"],
  地: ["他", "池", "场"],
};

/**
 * Common Chinese bigrams & grammatical collocations used ONLY inside Tier 2 (0.60 - 0.89)
 * to re-rank the 2–3 visual candidates by surrounding sentence context.
 */
const COMMON_BIGRAMS = new Set([
  "我是",
  "我有",
  "我爱",
  "我去",
  "我学",
  "我吃",
  "我看",
  "我们",
  "我的",
  "我在",
  "我不",
  "你是",
  "你好",
  "你有",
  "你去",
  "你爱",
  "你们",
  "你的",
  "他是",
  "他有",
  "他们",
  "她是",
  "学生",
  "学校",
  "学习",
  "中文",
  "中国",
  "今天",
  "明天",
  "昨天",
  "天天",
  "去了",
  "来去",
  "好人",
  "大人",
  "小人",
  "个人",
  "人们",
  "人口",
  "日本",
  "生日",
  "日子",
  "目光",
  "目的",
  "一本",
  "二本",
  "三本",
  "四本",
  "五本",
  "六本",
  "七本",
  "八本",
  "九本",
  "十本",
  "两本",
  "几本",
  "本书",
  "看书",
  "读书",
  "写字",
  "汉字",
  "一个",
  "二个",
  "三个",
  "四个",
  "五个",
  "六个",
  "七个",
  "八个",
  "九个",
  "十个",
  "两个",
  "几个",
  "未来",
  "周末",
  "国王",
  "玉米",
  "工作",
  "工人",
  "上下",
  "上午",
  "下午",
  "上学",
  "下学",
  "吃饭",
  "喝水",
  "太大",
  "太多",
  "太好",
  "太阳",
  "太空",
  "大家",
  "大学",
  "大小",
  "大王",
]);

const CHINESE_NUMERALS = new Set([
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
  "两",
  "几",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
]);

const COMMON_MEASURE_WORDS = new Set(["本", "个", "口", "只", "条", "杯", "碗", "张", "件"]);
const SENTENCE_INITIAL_PRONOUNS = new Set(["我", "你", "他", "她", "这", "那"]);
const COMMON_VERBS = new Set(["是", "有", "爱", "去", "学", "吃", "看", "说", "读", "写", "来", "买"]);

const PUNCTUATION_REGEX = /^[。，？！、；：“”‘’（）《》.,?!;:'"()[\]\s]$/;

/**
 * Resolves the OCR API key strictly prioritizing process.env.OCR_API_KEY and process.env.VISION_API_KEY,
 * with fallback to options.apiKey or existing local environment variables.
 */
function resolveOcrApiKey(options = {}) {
  return (
    options.apiKey ||
    process.env.OCR_API_KEY ||
    process.env.VISION_API_KEY ||
    process.env.GOOGLE_CLOUD_VISION_API_KEY ||
    process.env.GOOGLE_VISION_API_KEY ||
    process.env.GEMINI_OCR_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  );
}

/**
 * Returns 2–3 visually/structurally similar Chinese character alternatives for a detected character.
 * Never uses grammatical context; relies strictly on stroke/radical shape similarity.
 */
export function getVisualCharacterOptions(charText, explicitAlternatives = []) {
  const cleanChar = String(charText || "").trim();
  const candidates = [];

  const addCandidate = (ch) => {
    const c = String(ch || "").trim();
    if (c && c !== cleanChar && !candidates.includes(c)) {
      candidates.push(c);
    }
  };

  for (const alt of explicitAlternatives) {
    addCandidate(alt);
  }

  if (VISUAL_SIMILARITY_MAP[cleanChar]) {
    for (const similar of VISUAL_SIMILARITY_MAP[cleanChar]) {
      addCandidate(similar);
    }
  }

  if (candidates.length < 2 && cleanChar.length > 0) {
    const code = cleanChar.codePointAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) {
      const structuralFallbacks = ["口", "日", "木", "人", "大"];
      const nearby1 = String.fromCodePoint(code === 0x9fff ? code - 1 : code + 1);
      const nearby2 = String.fromCodePoint(code === 0x4e00 ? code + 2 : code - 1);
      addCandidate(nearby1);
      addCandidate(nearby2);
      for (const fb of structuralFallbacks) {
        if (candidates.length >= 3) break;
        addCandidate(fb);
      }
    } else {
      for (const fb of ["口", "一", "人"]) {
        if (candidates.length >= 3) break;
        addCandidate(fb);
      }
    }
  }

  return candidates.slice(0, 3);
}

/**
 * Evaluates a candidate character against its surrounding sentence context (prevChar, nextChar)
 * using Chinese bigram probabilities and grammatical structure rules (e.g. Numeral + Measure Word).
 */
export function scoreCandidateInContext(candidateChar, sentenceChars, position) {
  let score = 0;
  const prevChar = position > 0 ? sentenceChars[position - 1] : "";
  const nextChar =
    position + 1 < sentenceChars.length ? sentenceChars[position + 1] : "";

  if (prevChar && COMMON_BIGRAMS.has(`${prevChar}${candidateChar}`)) {
    score += 5;
  }
  if (nextChar && COMMON_BIGRAMS.has(`${candidateChar}${nextChar}`)) {
    score += 5;
  }

  // Grammatical Rule 1: After a numeral (e.g. "三"), measure words ("本", "个") have strong grammatical fit
  if (
    prevChar &&
    CHINESE_NUMERALS.has(prevChar) &&
    COMMON_MEASURE_WORDS.has(candidateChar)
  ) {
    score += 6;
  }

  // Grammatical Rule 2: Sentence-initial pronoun before a common verb (e.g. "我是", "我有")
  if (
    position === 0 &&
    SENTENCE_INITIAL_PRONOUNS.has(candidateChar) &&
    nextChar &&
    COMMON_VERBS.has(nextChar)
  ) {
    score += 4;
  }

  // Grammatical Rule 3: Common verb immediately following a pronoun (e.g. "我" + "是"/"有")
  if (
    prevChar &&
    SENTENCE_INITIAL_PRONOUNS.has(prevChar) &&
    COMMON_VERBS.has(candidateChar)
  ) {
    score += 3;
  }

  return score;
}

/**
 * Re-ranks the 3 visual candidates for a Tier 2 character position by grammatical/contextual fit:
 *   - Index 0: { char, reason: "Rank #1: Best grammatical context fit" }
 *   - Index 1: { char, reason: "Rank #2: Visual stroke match" }
 *   - Index 2: { char, reason: "Rank #3: Visual stroke match" }
 * Always preserves the literal written attempt in the options list so the student can choose it if intended.
 */
export function rankVisualCandidatesByContext(
  originalAttempt,
  visualAlts,
  sentenceChars,
  position
) {
  // Build the 3-character visual candidate pool: [originalAttempt, alt1, alt2]
  const pool = [originalAttempt];
  for (const alt of visualAlts) {
    if (alt && !pool.includes(alt) && pool.length < 3) {
      pool.push(alt);
    }
  }

  // Score each visual candidate against the surrounding sentence context
  const scored = pool.map((char, originalOrder) => ({
    char,
    originalOrder,
    contextScore: scoreCandidateInContext(char, sentenceChars, position),
  }));

  // Sort by highest contextScore; ties preserve original visual order (originalAttempt first)
  scored.sort((a, b) => {
    if (b.contextScore !== a.contextScore) {
      return b.contextScore - a.contextScore;
    }
    return a.originalOrder - b.originalOrder;
  });

  const bestContextualChar = scored[0].char;

  // Build remaining visual matches ensuring originalAttempt is at index 1 if it wasn't #1
  const remaining = pool.filter((ch) => ch !== bestContextualChar);

  const rankedChars = [bestContextualChar, ...remaining].slice(0, 3);

  return rankedChars.map((char, idx) => ({
    char,
    reason:
      idx === 0
        ? "Rank #1: Best grammatical context fit"
        : `Rank #${idx + 1}: Visual stroke match`,
  }));
}

/**
 * Maps normalized OCR output into the 3-tier confidence response contract:
 *   - Tier 1 (>= 0.90): status = "SUCCESS", requiresVerification = false, literal text preserved (NO context ranking)
 *   - Tier 2 (0.60 - 0.89): status = "LOW_CONFIDENCE", requiresVerification = true, context-ranked characterCandidates
 *   - Tier 3 (< 0.60): status = "UNREADABLE", requiresVerification = false, text = ""
 */
export function buildThreeTierOcrResponse(normalizedResult) {
  const rawText = String(
    normalizedResult?.originalText ?? normalizedResult?.text ?? normalizedResult?.transcription ?? ""
  );
  const chars = Array.isArray(normalizedResult?.characters)
    ? normalizedResult.characters
    : [];

  const confidence = normalizedResult?.provider === "gemini-vision"
    ? null : parseConfidence(normalizedResult?.confidence, false);
  // Keep source metadata for the review adapter; ranked text is only a suggestion.
  const source = { originalText: rawText, characters: chars, provider: normalizedResult?.provider };
  const segments = chars.map((character) => ({
    text: String(character?.originalCharacter ?? character?.character ?? ""),
    confidence: normalizedResult?.provider === "gemini-vision" ? null : parseConfidence(character?.confidence),
  }));

  // Tier 3: Low Confidence (< 0.60) or empty/unreadable input -> NO context ranking
  if (!rawText.trim() || (confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD)) {
    return {
      ...source,
      status: "UNREADABLE",
      text: "",
      recognizedText: "",
      confidence,
      requiresVerification: false,
      characterCandidates: [],
      segments: [],
    };
  }

  // Tier 1: High Confidence (>= 0.90) -> Pass directly without modification (NO context ranking)
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    return {
      ...source,
      status: "SUCCESS",
      text: rawText,
      recognizedText: rawText,
      confidence,
      requiresVerification: false,
      characterCandidates: [],
      segments,
    };
  }

  // Tier 2: Medium Confidence (0.60 - 0.89) -> Context-Aware Candidate Ranking
  const sentenceChars =
    chars.length > 0
      ? chars.map((c) => String(c?.originalCharacter ?? c?.character ?? "").trim())
      : Array.from(rawText);

  const topContextualChars = [...sentenceChars];
  const characterCandidates = [];

  chars.forEach((charEntry, index) => {
    const ch = sentenceChars[index];
    if (!ch || PUNCTUATION_REGEX.test(ch)) {
      return;
    }

    const posConfidence =
      parseConfidence(charEntry?.confidence) ?? confidence;

    if (posConfidence < HIGH_CONFIDENCE_THRESHOLD) {
      const explicitAlts = [];
      if (
        charEntry?.originalCharacter &&
        charEntry.originalCharacter !== ch
      ) {
        explicitAlts.push(charEntry.originalCharacter);
      }
      if (Array.isArray(charEntry?.options)) {
        for (const opt of charEntry.options) {
          explicitAlts.push(typeof opt === "string" ? opt : opt?.char);
        }
      }

      const visualAlts = getVisualCharacterOptions(ch, explicitAlts);
      const rankedOptions = rankVisualCandidatesByContext(
        ch,
        visualAlts,
        sentenceChars,
        index
      );

      if (rankedOptions.length > 0) {
        topContextualChars[index] = rankedOptions[0].char;
      }

      characterCandidates.push({
        position: index,
        originalAttempt: ch,
        confidence: posConfidence,
        options: rankedOptions,
      });
    }
  });

  // Fallback if overall confidence is in [0.60, 0.89] but all individual symbols were >= 0.90
  if (characterCandidates.length === 0 && sentenceChars.length > 0) {
    let minIdx = 0;
    let minConf = Infinity;

    chars.forEach((charEntry, index) => {
      const ch = String(charEntry?.character || "").trim();
      if (!ch || PUNCTUATION_REGEX.test(ch)) return;
      const c = parseConfidence(charEntry?.confidence) ?? confidence;
      if (c < minConf) {
        minConf = c;
        minIdx = index;
      }
    });

    const targetChar = sentenceChars[minIdx] || rawText[0] || "";
    if (targetChar) {
      const visualAlts = getVisualCharacterOptions(targetChar);
      const rankedOptions = rankVisualCandidatesByContext(
        targetChar,
        visualAlts,
        sentenceChars,
        minIdx
      );
      if (rankedOptions.length > 0) {
        topContextualChars[minIdx] = rankedOptions[0].char;
      }
      characterCandidates.push({
        position: minIdx,
        originalAttempt: targetChar,
        confidence: Number.isFinite(minConf) ? minConf : confidence,
        options: rankedOptions,
      });
    }
  }

  const recognizedText = topContextualChars.join("");

  return {
    ...source,
    status: "LOW_CONFIDENCE",
    confidence,
    requiresVerification: true,
    recognizedText,
    text: rawText,
    characterCandidates,
    segments,
  };
}

// Normalization rounds display scores. Classify using unrounded evidence and
// keep unknown/partial confidence distinct from an observed zero. Gemini's
// generated confidence values are self-ratings, so require confirmation.
function normalizeForRouting(raw, options) {
  const result = normalizeOcrResult(raw, options);
  const scores = (raw.characters || [])
    .filter((entry) => typeof entry?.character === "string" && entry.character.trim())
    .map((entry) => parseConfidence(entry.confidence, false));
  result.confidence = raw.provider === "gemini-vision" ? null : scores.length
    ? scores.every((score) => score !== null)
      ? scores.reduce((mean, score, index) => mean + (score - mean) / (index + 1), 0)
      : null
    : parseConfidence(raw.overallConfidence, false);
  return result;
}

/**
 * Recognizes handwritten Chinese characters from a Base64-encoded PNG image (`data:image/png;base64,...`)
 * using the 3-tier confidence model with Tier 2 context-aware candidate ranking.
 */
export async function recognizeHandwriting(imageBase64, options = {}) {
  const opts =
    typeof options === "string"
      ? { mimeType: options }
      : options && typeof options === "object"
      ? options
      : {};

  let prepared;
  try {
    prepared = prepareRecognitionInput(
      opts.mimeType && (Buffer.isBuffer(imageBase64) || imageBase64 instanceof Uint8Array)
        ? { image: imageBase64, mimeType: opts.mimeType }
        : imageBase64
    );
  } catch {
    return {
      status: "UNREADABLE",
      text: "",
      recognizedText: "",
      confidence: 0,
      requiresVerification: false,
      characterCandidates: [],
      segments: [],
    };
  }

  const { image, strokes, canvas, language } = prepared;
  const strokeClusters = clusterStrokesIntoCharacters(strokes);

  if (opts.mockResult) {
    const normalized = normalizeForRouting(opts.mockResult, {
      strokeClusters,
      canvas,
      language,
      provider: "mock",
    });
    return buildThreeTierOcrResponse(normalized);
  }

  const apiKey = resolveOcrApiKey(opts);
  if (!apiKey) {
    const err = new Error(
      "Missing vision API key. Set OCR_API_KEY or VISION_API_KEY in environment variables."
    );
    err.code = "MISSING_API_KEY";
    err.status = 500;
    throw err;
  }

  const provider = (
    opts.provider ||
    process.env.OCR_PROVIDER ||
    "auto"
  ).toLowerCase();
  const model =
    opts.model || process.env.GEMINI_OCR_MODEL || "gemini-2.5-flash";

  let rawModelResult;
  if (provider === "gemini") {
    rawModelResult = await callGeminiVisionOcr({
      base64: image.base64,
      mimeType: image.mimeType,
      strokeClusters,
      language,
      model,
      apiKey,
      fetchImpl: opts.fetchImpl,
    });
  } else if (provider === "vision" || provider === "cloud-vision") {
    rawModelResult = await callCloudVisionOcr({
      base64: image.base64,
      language,
      apiKey,
      fetchImpl: opts.fetchImpl,
    });
  } else {
    try {
      rawModelResult = await callCloudVisionOcr({
        base64: image.base64,
        language,
        apiKey,
        fetchImpl: opts.fetchImpl,
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
          fetchImpl: opts.fetchImpl,
        });
      } catch {
        throw visionErr;
      }
    }
  }

  const normalized = normalizeForRouting(rawModelResult, {
    strokeClusters,
    canvas,
    language,
    provider: rawModelResult?.provider || "google-cloud-vision",
  });

  return buildThreeTierOcrResponse(normalized);
}

/**
 * Orchestrates the 3-tier confidence OCR + conditional SSIM stroke verification + grammar review pipeline:
 *   - Condition A (Tier 1 High Confidence >= 0.90):
 *     Runs `evaluateStrokeDifference()` immediately on the transcribed character(s) and passes
 *     `strokeAnalysis` straight into `analyzeGrammar()`.
 *   - Condition B (Tier 2 Medium Confidence 0.60 - 0.89):
 *     Skips SSIM on initial load while candidates are displayed (`strokeAnalysis: { evaluated: false }`).
 *     Runs `evaluateStrokeDifference()` ONLY AFTER the user confirms one of the candidate options
 *     (`{ text: "...", selectedChar: "..." }`).
 *   - Tier 3 (Low Confidence < 0.60):
 *     Rejects with HTTP 422 and status "UNREADABLE".
 */
export async function processHandwritingReview(payload = {}, options = {}) {
  // Condition B Follow-Up: User confirmed a candidate character from the Tier 2 UI disambiguation panel
  if (
    typeof payload?.text === "string" &&
    payload.text.trim().length > 0 &&
    !payload.imageBase64
  ) {
    const confirmedText = payload.text.trim();
    const targetChar =
      String(payload.selectedChar || "").trim() ||
      Array.from(confirmedText)[0] ||
      "";
    const userCanvas = payload.userCanvas || payload.canvas || null;

    let ssimResult = {
      hasMissingStrokes: false,
      missingPercentage: 0,
      missingRegion: "none",
    };
    if (userCanvas && targetChar) {
      ssimResult = evaluateStrokeDifference(userCanvas, targetChar);
    }

    const strokeAnalysis = {
      evaluated: true,
      hasMissingStrokes: ssimResult.hasMissingStrokes,
      missingPercentage: ssimResult.missingPercentage,
      missingRegion: ssimResult.missingRegion,
      targetChar,
    };

    const grammar = await analyzeGrammar(confirmedText, strokeAnalysis, options);

    return {
      httpStatus: 200,
      body: {
        status: "COMPLETE",
        recognizedText: confirmedText,
        confidence:
          typeof payload.confidence === "number" ? payload.confidence : 0.85,
        strokeAnalysis: {
          evaluated: true,
          hasMissingStrokes: strokeAnalysis.hasMissingStrokes,
          missingPercentage: strokeAnalysis.missingPercentage,
        },
        grammar: {
          hasErrors: grammar.hasErrors,
          correctedText: grammar.correctedText,
          issues: grammar.issues,
        },
      },
    };
  }

  // Initial Image Submission: Run 3-Tier OCR
  const imageInput = payload?.imageBase64 || payload?.image || "";
  const ocrResult = await recognizeHandwriting(imageInput, options);

  // Tier 3 (< 0.60): Reject immediately with HTTP 422 and status "UNREADABLE"
  if (ocrResult.status === "UNREADABLE") {
    return {
      httpStatus: 422,
      body: {
        status: "UNREADABLE",
        message:
          "Could not detect handwriting clearly. Please rewrite your characters more legibly.",
        recognizedText: "",
        confidence: ocrResult.confidence,
        requiresVerification: false,
        characterCandidates: [],
      },
    };
  }

  // Condition B Initial Load (Tier 2: 0.60 - 0.89):
  // DO NOT run SSIM while candidates are being displayed; return verification payload
  if (ocrResult.status === "LOW_CONFIDENCE" || ocrResult.requiresVerification) {
    return {
      httpStatus: 200,
      body: {
        status: "LOW_CONFIDENCE",
        recognizedText: ocrResult.recognizedText,
        text: ocrResult.text,
        confidence: ocrResult.confidence,
        requiresVerification: true,
        characterCandidates: ocrResult.characterCandidates,
        strokeAnalysis: {
          evaluated: false,
        },
      },
    };
  }

  // Condition A (Tier 1: High Confidence >= 0.90):
  // Run evaluateStrokeDifference() directly on the transcribed character(s) and pass to analyzeGrammar()
  const targetChar =
    String(payload.targetChar || "").trim() ||
    Array.from(ocrResult.text)[0] ||
    "";
  const userCanvas = payload.userCanvas || imageInput;

  let ssimResult = {
    hasMissingStrokes: false,
    missingPercentage: 0,
    missingRegion: "none",
  };
  if (userCanvas && targetChar) {
    ssimResult = evaluateStrokeDifference(userCanvas, targetChar);
  }

  const strokeAnalysis = {
    evaluated: true,
    hasMissingStrokes: ssimResult.hasMissingStrokes,
    missingPercentage: ssimResult.missingPercentage,
    missingRegion: ssimResult.missingRegion,
    targetChar,
  };

  const grammar = await analyzeGrammar(ocrResult.text, strokeAnalysis, options);

  return {
    httpStatus: 200,
    body: {
      status: "COMPLETE",
      recognizedText: ocrResult.text,
      confidence: ocrResult.confidence,
      strokeAnalysis: {
        evaluated: true,
        hasMissingStrokes: strokeAnalysis.hasMissingStrokes,
        missingPercentage: strokeAnalysis.missingPercentage,
      },
      grammar: {
        hasErrors: grammar.hasErrors,
        correctedText: grammar.correctedText,
        issues: grammar.issues,
      },
    },
  };
}

export const recogniseHandwriting = recognizeHandwriting;
export default recognizeHandwriting;
