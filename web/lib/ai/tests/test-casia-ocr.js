import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recognizeHandwriting } from "../ocr.js";
import { buildHandwritingFixture } from "../testFixtures.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.join(__dirname, "casia-samples");
const MANIFEST_PATH = path.join(SAMPLES_DIR, "manifest.json");

const HF_ROWS_ENDPOINT =
  "https://datasets-server.huggingface.co/rows?dataset=Teklia%2FCASIA-HWDB2-line&config=default&split=test&offset=0&length=5";

/**
 * Loads environment variables from .env.local or web/.env.local when run directly via Node CLI,
 * mapping existing keys to OCR_API_KEY / VISION_API_KEY if not already set.
 */
function loadEnvLocal() {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "web", ".env.local"),
    path.resolve(__dirname, "..", "..", "..", ".env.local"),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed
          .slice(eqIdx + 1)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }

  const fallbackKey =
    process.env.OCR_API_KEY ||
    process.env.VISION_API_KEY ||
    process.env.GOOGLE_CLOUD_VISION_API_KEY ||
    process.env.GOOGLE_VISION_API_KEY ||
    process.env.GEMINI_OCR_API_KEY ||
    process.env.GEMINI_API_KEY;

  if (fallbackKey) {
    if (!process.env.OCR_API_KEY) process.env.OCR_API_KEY = fallbackKey;
    if (!process.env.VISION_API_KEY) process.env.VISION_API_KEY = fallbackKey;
  }
}

/**
 * Loads 5 sample handwritten Chinese line images from Hugging Face's
 * Teklia/CASIA-HWDB2-line dataset (using local cache if already downloaded).
 */
async function loadCasiaSamples(count = 5) {
  if (fs.existsSync(MANIFEST_PATH)) {
    const cached = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    if (Array.isArray(cached) && cached.length >= count) {
      const ready = cached
        .slice(0, count)
        .every((item) => fs.existsSync(path.join(SAMPLES_DIR, item.fileName)));
      if (ready) {
        return cached.slice(0, count).map((item) => {
          const buf = fs.readFileSync(path.join(SAMPLES_DIR, item.fileName));
          return {
            id: item.id,
            groundTruth: item.groundTruth,
            filePath: path.join(SAMPLES_DIR, item.fileName),
            base64DataUrl: `data:image/png;base64,${buf.toString("base64")}`,
          };
        });
      }
    }
  }

  console.log(
    "Downloading sample rows from Hugging Face dataset: Teklia/CASIA-HWDB2-line..."
  );
  const res = await fetch(HF_ROWS_ENDPOINT);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch CASIA-HWDB2-line metadata from Hugging Face (HTTP ${res.status}).`
    );
  }

  const data = await res.json();
  const rows = Array.isArray(data?.rows) ? data.rows.slice(0, count) : [];
  if (rows.length === 0) {
    throw new Error("Hugging Face dataset returned 0 rows.");
  }

  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  const manifest = [];
  const loadedSamples = [];

  for (let i = 0; i < rows.length; i += 1) {
    const rowObj = rows[i]?.row || {};
    const groundTruth = String(rowObj.text || "").trim();
    const imageUrl = rowObj.image?.src;

    if (!imageUrl || !groundTruth) {
      continue;
    }

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      throw new Error(
        `Failed to download sample image #${i + 1} (HTTP ${imgRes.status}).`
      );
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = `casia-line-${String(i + 1).padStart(2, "0")}.png`;
    const filePath = path.join(SAMPLES_DIR, fileName);
    fs.writeFileSync(filePath, buffer);

    const id = `casia-test-${i + 1}`;
    manifest.push({ id, fileName, groundTruth });
    loadedSamples.push({
      id,
      groundTruth,
      filePath,
      base64DataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
  return loadedSamples;
}

function assertValidThreeTierContract(res, contextLabel) {
  assert.ok(
    res && typeof res === "object",
    `${contextLabel}: result must be an object`
  );
  assert.ok(
    ["SUCCESS", "LOW_CONFIDENCE", "UNREADABLE"].includes(res.status),
    `${contextLabel}: invalid status "${res.status}"`
  );
  assert.ok(
    typeof res.confidence === "number" &&
      res.confidence >= 0.0 &&
      res.confidence <= 1.0,
    `${contextLabel}: confidence must be a number in [0.0, 1.0], got ${res.confidence}`
  );
  assert.equal(
    typeof res.requiresVerification,
    "boolean",
    `${contextLabel}: requiresVerification must be boolean`
  );
  assert.ok(
    Array.isArray(res.characterCandidates),
    `${contextLabel}: characterCandidates must be an array`
  );

  if (res.status === "SUCCESS") {
    assert.ok(
      res.confidence >= 0.9,
      `${contextLabel}: SUCCESS requires confidence >= 0.90`
    );
    assert.equal(res.requiresVerification, false);
    assert.equal(res.characterCandidates.length, 0);
  } else if (res.status === "LOW_CONFIDENCE") {
    assert.ok(
      res.confidence >= 0.6 && res.confidence < 0.9,
      `${contextLabel}: LOW_CONFIDENCE requires confidence in [0.60, 0.89]`
    );
    assert.equal(res.requiresVerification, true);
    assert.equal(typeof res.recognizedText, "string");
    assert.ok(
      res.characterCandidates.length > 0,
      `${contextLabel}: LOW_CONFIDENCE must populate characterCandidates`
    );
    for (const cand of res.characterCandidates) {
      assert.equal(typeof cand.position, "number");
      assert.ok(
        Array.isArray(cand.options) &&
          cand.options.length >= 2 &&
          cand.options.length <= 3,
        `${contextLabel}: options must have 2-3 items`
      );
      assert.equal(
        cand.options[0].reason,
        "Rank #1: Best grammatical context fit",
        `${contextLabel}: index 0 must be Rank #1: Best grammatical context fit`
      );
      for (let i = 1; i < cand.options.length; i += 1) {
        assert.equal(
          cand.options[i].reason,
          `Rank #${i + 1}: Visual stroke match`,
          `${contextLabel}: index ${i} must be Rank #${i + 1}: Visual stroke match`
        );
      }
    }
  } else if (res.status === "UNREADABLE") {
    assert.ok(
      res.confidence < 0.6,
      `${contextLabel}: UNREADABLE requires confidence < 0.60`
    );
    assert.equal(res.requiresVerification, false);
    assert.equal(res.text, "");
    assert.equal(res.characterCandidates.length, 0);
  }
}

async function runCasiaTest() {
  loadEnvLocal();

  console.log(
    "======================================================================"
  );
  console.log(
    " Inkling 3-Tier Handwriting OCR Test — Teklia/CASIA-HWDB2-line"
  );
  console.log(
    "======================================================================\n"
  );

  // 1. Evaluate the 5 real human handwritten Chinese line images from Teklia/CASIA-HWDB2-line
  const samples = await loadCasiaSamples(5);
  assert.ok(samples.length >= 3, "Expected at least 3 CASIA samples");

  for (const sample of samples) {
    const result = await recognizeHandwriting(sample.base64DataUrl);
    assertValidThreeTierContract(result, sample.id);

    console.log(`Sample ID:                 ${sample.id}`);
    console.log(`Ground Truth:              ${sample.groundTruth}`);
    console.log(`OCR Transcribed Output:    ${result.text}`);
    console.log(
      `Confidence Score & Status: ${result.confidence} (${result.status}) | requiresVerification: ${result.requiresVerification}`
    );
    if (result.requiresVerification) {
      console.log(
        `Disambiguation Candidates: ${JSON.stringify(result.characterCandidates)}`
      );
    } else {
      console.log("Disambiguation Candidates: [] (Not triggered)");
    }
    console.log("");
  }

  console.log(
    "--- Verification: Tier 1, Tier 2 Context Re-Ranking & Tier 3 Checks ---\n"
  );

  // 2. Verify Tier 1 Preservation (>= 0.90): DO NOT run context ranking on Tier 1
  const missingMeasureFixture = buildHandwritingFixture("我有三书");
  const tier1Result = await recognizeHandwriting(missingMeasureFixture.dataUrl);
  assertValidThreeTierContract(tier1Result, "tier-1-literal-preservation");
  assert.equal(tier1Result.status, "SUCCESS");
  assert.equal(
    tier1Result.text,
    "我有三书",
    `Tier 1 must NOT auto-correct "我有三书" to "我有三本书" (got "${tier1Result.text}")`
  );
  console.log("Sample ID:                 tier-1-clear-mistake-preserved");
  console.log("Ground Truth:              我有三书 (Clear writing >= 0.90 — NO context re-ranking)");
  console.log(`OCR Transcribed Output:    ${tier1Result.text}`);
  console.log(
    `Confidence Score & Status: ${tier1Result.confidence} (${tier1Result.status}) | requiresVerification: ${tier1Result.requiresVerification}`
  );
  console.log(
    `Disambiguation Candidates: ${JSON.stringify(tier1Result.characterCandidates)}\n`
  );

  // 3. Verify Tier 2 (0.60 - 0.89): Context-Aware Candidate Ranking places best grammatical fit at index 0
  // Case A: "我有三书" with messy "书" at position 3 (confidence 0.65, overall 0.86)
  // Visual candidates for "书" are ["书", "本", "韦"]; after numeral "三", "本" is Rank #1 contextual fit!
  const tier2MeasureWord = await recognizeHandwriting(
    missingMeasureFixture.dataUrl,
    {
      mockResult: {
        transcription: "我有三书",
        overallConfidence: 0.78,
        characters: [
          { character: "我", confidence: 0.94 },
          { character: "有", confidence: 0.92 },
          { character: "三", confidence: 0.95 },
          { character: "书", confidence: 0.65 },
        ],
      },
    }
  );
  assertValidThreeTierContract(tier2MeasureWord, "tier-2-context-rerank-measure");
  assert.equal(tier2MeasureWord.status, "LOW_CONFIDENCE");
  assert.equal(tier2MeasureWord.requiresVerification, true);
  assert.equal(tier2MeasureWord.recognizedText, "我有三本");
  assert.equal(tier2MeasureWord.characterCandidates.length, 1);
  assert.equal(tier2MeasureWord.characterCandidates[0].position, 3);
  assert.deepEqual(tier2MeasureWord.characterCandidates[0].options, [
    { char: "本", reason: "Rank #1: Best grammatical context fit" },
    { char: "书", reason: "Rank #2: Visual stroke match" },
    { char: "韦", reason: "Rank #3: Visual stroke match" },
  ]);

  console.log("Sample ID:                 tier-2-context-rerank-measure-word");
  console.log("Ground Truth:              我有三书 (Messy 4th char at pos 3, confidence 0.65)");
  console.log(`Recognized Text (Rank #1): ${tier2MeasureWord.recognizedText}`);
  console.log(
    `Confidence Score & Status: ${tier2MeasureWord.confidence} (${tier2MeasureWord.status}) | requiresVerification: ${tier2MeasureWord.requiresVerification}`
  );
  console.log(
    `Disambiguation Candidates: ${JSON.stringify(tier2MeasureWord.characterCandidates, null, 2)}\n`
  );

  // Case B: "我是字生" where messy "学" was visually misread as "字" (pos 2, confidence 0.68) before "生"
  // Visual candidates for "字" are ["字", "学", "子"]; before "生", "学" ("学生") is Rank #1 contextual fit!
  const tier2CompoundWord = await recognizeHandwriting(
    missingMeasureFixture.dataUrl,
    {
      mockResult: {
        transcription: "我是字生",
        overallConfidence: 0.76,
        characters: [
          { character: "我", confidence: 0.95 },
          { character: "是", confidence: 0.93 },
          { character: "字", confidence: 0.68 },
          { character: "生", confidence: 0.92 },
        ],
      },
    }
  );
  assertValidThreeTierContract(tier2CompoundWord, "tier-2-context-rerank-compound");
  assert.equal(tier2CompoundWord.recognizedText, "我是学生");
  assert.deepEqual(tier2CompoundWord.characterCandidates[0].options, [
    { char: "学", reason: "Rank #1: Best grammatical context fit" },
    { char: "字", reason: "Rank #2: Visual stroke match" },
    { char: "子", reason: "Rank #3: Visual stroke match" },
  ]);

  console.log("Sample ID:                 tier-2-context-rerank-compound-word");
  console.log("Ground Truth:              我是学生 (Messy 学 read as 字 at pos 2)");
  console.log(`Recognized Text (Rank #1): ${tier2CompoundWord.recognizedText}`);
  console.log(
    `Confidence Score & Status: ${tier2CompoundWord.confidence} (${tier2CompoundWord.status}) | requiresVerification: ${tier2CompoundWord.requiresVerification}`
  );
  console.log(
    `Disambiguation Candidates: ${JSON.stringify(tier2CompoundWord.characterCandidates, null, 2)}\n`
  );

  // 4. Verify Tier 3 (< 0.60): Return UNREADABLE immediately with no context ranking
  const unreadableResult = await recognizeHandwriting(
    missingMeasureFixture.dataUrl,
    {
      mockResult: {
        transcription: "口日目",
        overallConfidence: 0.42,
        characters: [
          { character: "口", confidence: 0.38 },
          { character: "日", confidence: 0.45 },
          { character: "目", confidence: 0.43 },
        ],
      },
    }
  );
  assertValidThreeTierContract(unreadableResult, "tier-3-low-confidence");
  assert.equal(unreadableResult.status, "UNREADABLE");
  assert.equal(unreadableResult.text, "");
  assert.equal(unreadableResult.requiresVerification, false);
  console.log("Sample ID:                 tier-3-unreadable-simulation");
  console.log("Ground Truth:              <Unreadable scribble>");
  console.log(`OCR Transcribed Output:    "${unreadableResult.text}"`);
  console.log(
    `Confidence Score & Status: ${unreadableResult.confidence} (${unreadableResult.status}) | requiresVerification: ${unreadableResult.requiresVerification}`
  );
  console.log(
    `Disambiguation Candidates: ${JSON.stringify(unreadableResult.characterCandidates)}\n`
  );

  console.log(
    "======================================================================"
  );
  console.log(
    " ALL CASIA-HWDB2-line & TIER 2 CONTEXT RANKING ASSERTIONS PASSED"
  );
  console.log(
    "======================================================================"
  );
}

runCasiaTest().catch((err) => {
  console.error("CASIA OCR Test Error:", err);
  process.exit(1);
});
