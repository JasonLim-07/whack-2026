import fs from "node:fs";
import path from "node:path";
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

async function main() {
  loadEnvLocal();

  const customPngArg = process.argv[2];
  const hasApiKey = Boolean(
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

  console.log("=== Inkling Handwriting OCR Benchmark (4 Test Cases) ===\n");
  if (!hasApiKey) {
    console.log(
      "NOTE: No GEMINI_OCR_API_KEY / GEMINI_API_KEY found in web/.env.local yet."
    );
    console.log(
      "Running in local fixture verification mode. Add your Google AI Studio key to web/.env.local to run live Gemini Vision OCR!\n"
    );
  }

  for (const testCase of BENCHMARK_CASES) {
    const fixture = buildHandwritingFixture(testCase.sentence, {
      wobble: testCase.wobble,
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
              transcription: testCase.sentence,
              overallConfidence: 0.94,
              characters: Array.from(testCase.sentence).map((ch) => ({
                character: ch,
                confidence: 0.94,
              })),
            },
          }
    );

    const match = result.transcription === testCase.sentence;
    console.log(`[${match ? "PASS" : "DIFF"}] ${testCase.description}`);
    console.log(`  Expected:      "${testCase.sentence}"`);
    console.log(`  Transcribed:   "${result.transcription}"`);
    console.log(
      `  Confidence:    ${result.confidence} (${result.characters.length} character regions mapped)`
    );
    console.log("");
  }
}

main().catch((err) => {
  console.error("Benchmark error:", err.message);
  process.exit(1);
});
