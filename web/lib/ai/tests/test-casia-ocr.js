import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recognizeHandwriting } from "../ocr.js";
import { computeCharAccuracy } from "../runBenchmark.js";
import { buildHandwritingFixture } from "../testFixtures.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.join(__dirname, "casia-samples");
const MANIFEST_PATH = path.join(SAMPLES_DIR, "manifest.json");

const HF_ROWS_ENDPOINT =
  "https://datasets-server.huggingface.co/rows?dataset=Teklia%2FCASIA-HWDB2-line&config=default&split=test&offset=0&length=5";

/**
 * Loads environment variables from .env.local or web/.env.local when run directly via Node CLI.
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
}

/**
 * Normalizes whitespace and full-width/half-width punctuation for fair comparison
 * against CASIA-HWDB2 ground-truth labels while keeping character differences strict.
 */
function normalizeForComparison(str) {
  return String(str || "")
    .replace(/\s+/g, "")
    .replace(/,/g, "，")
    .replace(/\./g, "。")
    .replace(/\?/g, "？")
    .replace(/!/g, "！")
    .replace(/:/g, "：")
    .replace(/;/g, "；")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）");
}

/**
 * Determines PERFECT / PARTIAL / FAILED match status.
 */
function getMatchStatus(expected, actual) {
  if (!actual || actual.trim().length === 0) {
    return { status: "FAILED", accuracy: 0 };
  }
  const normExp = normalizeForComparison(expected);
  const normAct = normalizeForComparison(actual);

  if (normExp === normAct) {
    return { status: "PERFECT", accuracy: 1.0 };
  }

  const stats = computeCharAccuracy(normExp, normAct);
  if (stats.rate >= 0.5) {
    return { status: "PARTIAL", accuracy: stats.rate };
  }
  return { status: "FAILED", accuracy: stats.rate };
}

/**
 * Fetches 5 real human handwritten Chinese line images from Hugging Face's
 * Teklia/CASIA-HWDB2-line dataset (or loads them from the local cache if already downloaded).
 */
async function loadCasiaSamples(count = 5) {
  if (fs.existsSync(MANIFEST_PATH)) {
    const cached = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    if (Array.isArray(cached) && cached.length >= count) {
      const ready = cached.slice(0, count).every((item) =>
        fs.existsSync(path.join(SAMPLES_DIR, item.fileName))
      );
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
    "Fetching sample rows from Hugging Face dataset: Teklia/CASIA-HWDB2-line..."
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

async function runCasiaTest() {
  loadEnvLocal();

  console.log(
    "======================================================================"
  );
  console.log(
    " Inkling Real Handwriting OCR Evaluation — Teklia/CASIA-HWDB2-line"
  );
  console.log(
    "======================================================================\n"
  );

  const samples = await loadCasiaSamples(5);
  let totalCharMatches = 0;
  let totalCharCount = 0;
  let perfectCount = 0;
  let partialCount = 0;
  let failedCount = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const result = await recognizeHandwriting(sample.base64DataUrl, {
      skipCache: true,
    });

    const ocrText = result.text ?? result.transcription ?? "";
    const confidence = result.confidence;
    const { status, accuracy } = getMatchStatus(sample.groundTruth, ocrText);

    const charStats = computeCharAccuracy(
      normalizeForComparison(sample.groundTruth),
      normalizeForComparison(ocrText)
    );
    totalCharMatches += charStats.effectiveMatches;
    totalCharCount += charStats.maxLength;

    if (status === "PERFECT") perfectCount += 1;
    else if (status === "PARTIAL") partialCount += 1;
    else failedCount += 1;

    const validConfidence =
      typeof confidence === "number" && confidence >= 0.0 && confidence <= 1.0;

    console.log(
      `--- Sample #${i + 1} (${sample.id}) [Saved: ${path.basename(sample.filePath)}] ---`
    );
    console.log(`Expected (Ground Truth): ${sample.groundTruth}`);
    console.log(`OCR Output:              ${ocrText}`);
    console.log(
      `Confidence Score:        ${confidence} (Valid [0.0..1.0]: ${validConfidence ? "YES" : "NO"})`
    );
    console.log(
      `Match Status:            ${status} (Character Accuracy: ${(accuracy * 100).toFixed(1)}% | ${charStats.effectiveMatches}/${charStats.maxLength} chars)\n`
    );

    if (!validConfidence) {
      throw new Error(
        `Invalid confidence score on ${sample.id}: expected number in [0.0, 1.0], got ${confidence}`
      );
    }
  }

  // Verification Criterion 3: Explicitly verify ungrammatical / mistaken Chinese is NOT auto-corrected
  console.log(
    "--- Verification Check: Literal Error Preservation (No Auto-Correction) ---"
  );
  const errorCheckCases = ["我有三书。", "我你爱。"];
  for (const ungrammatical of errorCheckCases) {
    const fixture = buildHandwritingFixture(ungrammatical);
    const res = await recognizeHandwriting(fixture.dataUrl);
    const out = res.text ?? res.transcription ?? "";
    const preserved = out === ungrammatical;
    console.log(`Expected (Ground Truth): ${ungrammatical}`);
    console.log(`OCR Output:              ${out}`);
    console.log(`Confidence Score:        ${res.confidence}`);
    console.log(
      `Match Status:            ${preserved ? "PERFECT (Mistake Preserved Literally)" : "FAILED (Altered)"}\n`
    );
    if (!preserved) {
      throw new Error(
        `OCR silently altered ungrammatical test case "${ungrammatical}" to "${out}"`
      );
    }
  }

  const overallAccuracy =
    totalCharCount > 0 ? ((totalCharMatches / totalCharCount) * 100).toFixed(1) : "0.0";

  console.log(
    "======================================================================"
  );
  console.log(" CASIA-HWDB2-line Real Handwriting Summary");
  console.log(
    "======================================================================"
  );
  console.log(`Samples Evaluated:       ${samples.length}`);
  console.log(
    `Match Breakdown:         ${perfectCount} PERFECT | ${partialCount} PARTIAL | ${failedCount} FAILED`
  );
  console.log(
    `Overall Char Accuracy:   ${totalCharMatches}/${totalCharCount} (${overallAccuracy}%)`
  );
  console.log("Literal Error Check:     PASSED (No silent grammar correction)");
}

runCasiaTest().catch((err) => {
  console.error("CASIA OCR Test Error:", err.message);
  process.exit(1);
});
