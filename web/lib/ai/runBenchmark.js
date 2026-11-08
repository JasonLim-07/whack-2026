import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { transcribeHandwriting } from "./transcribe.js";
import { BENCHMARK_CASES, buildHandwritingFixture } from "./testFixtures.js";

/**
 * Loads environment variables from web/.env.local if present when running via node CLI.
 */
function loadEnvLocal() {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "web", ".env.local"),
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
 * Computes true Levenshtein edit distance between two Unicode character sequences.
 */
export function levenshteinDistance(expected, actual) {
  const a = Array.from(expected || "");
  const b = Array.from(actual || "");
  const m = a.length;
  const n = b.length;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Computes edit-distance character accuracy, properly penalizing insertions, deletions, and substitutions.
 */
export function computeCharAccuracy(expected, actual) {
  const expChars = Array.from(expected || "");
  const actChars = Array.from(actual || "");
  const maxLen = Math.max(expChars.length, actChars.length);
  if (maxLen === 0) {
    return {
      editDistance: 0,
      expectedLength: 0,
      actualLength: 0,
      maxLength: 0,
      effectiveMatches: 0,
      rate: 1,
    };
  }

  const dist = levenshteinDistance(expected, actual);
  const effectiveMatches = Math.max(0, maxLen - dist);

  return {
    editDistance: dist,
    expectedLength: expChars.length,
    actualLength: actChars.length,
    maxLength: maxLen,
    effectiveMatches,
    rate: effectiveMatches / maxLen,
  };
}

async function main() {
  loadEnvLocal();

  const customPngArg = process.argv[2];
  const hasApiKey = Boolean(
    process.env.GOOGLE_CLOUD_VISION_API_KEY ||
      process.env.GOOGLE_VISION_API_KEY ||
      process.env.GEMINI_OCR_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY
  );

  if (customPngArg) {
    const filePath = path.resolve(process.cwd(), customPngArg);
    const pngBuffer = fs.readFileSync(filePath);
    console.log(`Testing custom PNG: ${filePath}`);
    const result = await transcribeHandwriting(pngBuffer);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `=== Inkling Handwriting OCR Benchmark (${BENCHMARK_CASES.length} Synthetic Cases + PNG-Only + Diagnostics) ===`
  );
  console.log(
    `Mode: ${hasApiKey ? "LIVE API (Google Cloud Vision)" : "LOCAL MOCK (No API key found)"}\n`
  );

  let exactPassCount = 0;
  let rawExactPassCount = 0;
  let totalMaxChars = 0;
  let totalEffectiveMatches = 0;
  let currentCategory = "";

  for (const testCase of BENCHMARK_CASES) {
    if (testCase.category && testCase.category !== currentCategory) {
      currentCategory = testCase.category;
      console.log(`--- Category: ${currentCategory} ---`);
    }

    const fixture = buildHandwritingFixture(testCase.sentence, {
      wobble: testCase.wobble,
      jitter: testCase.jitter,
      slant: testCase.slant,
      charSize: testCase.charSize,
      charSpacing: testCase.charSpacing,
      scalePattern: testCase.scalePattern,
      dropStrokes: testCase.dropStrokes,
    });

    const expectedClean = fixture.expectedText;

    const result = await transcribeHandwriting(
      {
        image: fixture.dataUrl,
        writing: fixture.writing,
      },
      hasApiKey
        ? {}
        : {
            mockResult: {
              transcription: expectedClean,
              overallConfidence: 0.94,
              characters: Array.from(expectedClean).map((ch) => ({
                character: ch,
                confidence: 0.94,
              })),
            },
          }
    );

    const exactMatch = result.text === expectedClean;
    const rawMatch = result.originalText === expectedClean;
    if (exactMatch) exactPassCount += 1;
    if (rawMatch) rawExactPassCount += 1;

    const charStats = computeCharAccuracy(expectedClean, result.text);
    totalMaxChars += charStats.maxLength;
    totalEffectiveMatches += charStats.effectiveMatches;

    console.log(
      `[${exactMatch ? "PASS" : "DIFF"}] ${testCase.id}: ${testCase.description}`
    );
    console.log(`  Expected:       "${expectedClean}"`);
    console.log(`  Raw Provider:   "${result.originalText}"`);
    console.log(`  Final Text:     "${result.text}"`);
    console.log(
      `  Confidence:     ${result.confidence} | Edit Dist: ${charStats.editDistance} (${charStats.effectiveMatches}/${charStats.maxLength}) | Uncertain Flagged: ${result.uncertainCharacters.length}`
    );
    console.log("");
  }

  // Test PNG-Only mode (no stroke metadata passed) on key cases
  console.log("--- Category: PNG-Only Input (No Stroke Metadata) ---");
  const pngOnlyCases = [
    { id: "png-only-01", sentence: "我是学生。" },
    { id: "png-only-02", sentence: "我有三书。" },
    { id: "png-only-03", sentence: "口日目。" },
  ];
  let pngOnlyPass = 0;
  for (const pCase of pngOnlyCases) {
    const fixture = buildHandwritingFixture(pCase.sentence);
    const result = await transcribeHandwriting(
      fixture.dataUrl, // Pure PNG data URL, no strokes array
      hasApiKey
        ? { skipCache: true }
        : {
            mockResult: {
              transcription: pCase.sentence,
              overallConfidence: 0.92,
              characters: Array.from(pCase.sentence).map((ch) => ({
                character: ch,
                confidence: 0.92,
              })),
            },
          }
    );
    const match = result.text === pCase.sentence;
    if (match) pngOnlyPass += 1;
    console.log(
      `[${match ? "PASS" : "DIFF"}] ${pCase.id} (PNG-only): Expected "${pCase.sentence}" -> Raw "${result.originalText}" -> Final "${result.text}" (Conf: ${result.confidence}, Uncertain: ${result.uncertainCharacters.length})`
    );
  }
  console.log("");

  // Missing-Stroke / Malformed Character Diagnostic Cases
  console.log("--- Category: Malformed / Missing-Stroke Diagnostics ---");
  const malformedCases = [
    {
      id: "diag-missing-stroke-ri",
      description: "Missing middle horizontal stroke in 日 (writing 口 instead of 日 in 日本。)",
      intended: "日本。",
      literallyWritten: "口本。",
      dropStrokes: [{ charIndex: 0, strokeIndex: 2 }],
    },
    {
      id: "diag-missing-stroke-wang",
      description: "Missing middle horizontal stroke in 王 (writing 工 instead of 王 in 王人。)",
      intended: "王人。",
      literallyWritten: "工人。",
      dropStrokes: [{ charIndex: 0, strokeIndex: 2 }],
    },
  ];

  for (const mCase of malformedCases) {
    const fixture = buildHandwritingFixture(mCase.intended, {
      dropStrokes: mCase.dropStrokes,
    });
    const result = await transcribeHandwriting(
      {
        image: fixture.dataUrl,
        writing: fixture.writing,
      },
      hasApiKey
        ? {}
        : {
            mockResult: {
              transcription: mCase.literallyWritten,
              overallConfidence: 0.78,
              characters: Array.from(mCase.literallyWritten).map((ch) => ({
                character: ch,
                confidence: 0.78,
              })),
            },
          }
    );
    console.log(`[DIAG] ${mCase.id}: ${mCase.description}`);
    console.log(`  Student intended: "${mCase.intended}" | Visually drawn: "${mCase.literallyWritten}"`);
    console.log(
      `  OCR output:       "${result.text}" (Confidence: ${result.confidence}, Uncertain: ${result.uncertainCharacters.length})`
    );
    console.log("");
  }

  const charAccuracyPct =
    totalMaxChars > 0
      ? ((totalEffectiveMatches / totalMaxChars) * 100).toFixed(1)
      : "100.0";

  console.log("=== Benchmark Summary (Synthetic Stroke Fixtures) ===");
  console.log(
    `Raw Provider Exact Sentence Match:   ${rawExactPassCount}/${BENCHMARK_CASES.length} (${(
      (rawExactPassCount / BENCHMARK_CASES.length) *
      100
    ).toFixed(1)}%)`
  );
  console.log(
    `Post-Processed Exact Sentence Match: ${exactPassCount}/${BENCHMARK_CASES.length} (${(
      (exactPassCount / BENCHMARK_CASES.length) *
      100
    ).toFixed(1)}%)`
  );
  console.log(
    `Edit-Distance Character Accuracy:    ${totalEffectiveMatches}/${totalMaxChars} (${charAccuracyPct}%)`
  );
  console.log(
    `PNG-Only (No Strokes) Match Rate:    ${pngOnlyPass}/${pngOnlyCases.length}`
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((err) => {
    console.error("Benchmark error:", err.message);
    process.exit(1);
  });
}
