import assert from "node:assert/strict";
import { CHAR_GLYPH_STROKES, buildHandwritingFixture } from "../testFixtures.js";
import {
  analyzeGrammar,
  buildStrokeVerificationPrompt,
  evaluateStrokeDifference,
  renderGlyphPolylinesToRgba,
} from "../../utils/ssim.js";
import { processHandwritingReview } from "../ocr.js";

/**
 * Applies natural handwriting variations to a character's stroke polylines:
 * -Subdivides segments and adds natural curvature / hand wobble
 * -Applies a ~10-degree slant and minor scale/position offset
 */
function applyNaturalHandwritingVariation(polylines) {
  const slantTan = Math.tan((8 * Math.PI) / 180); // ~8 deg slant
  return polylines.map((stroke, strokeIdx) => {
    const densePoints = [];
    for (let i = 0; i < stroke.length - 1; i += 1) {
      const [x0, y0] = stroke[i];
      const [x1, y1] = stroke[i + 1];
      const steps = 8;
      for (let s = 0; s <= steps; s += 1) {
        if (i > 0 && s === 0) continue;
        const t = s / steps;
        const bx = x0 + (x1 - x0) * t;
        const by = y0 + (y1 - y0) * t;
        // Natural slight bow/curve along the stroke (peaks at mid-stroke t = 0.5)
        const curveOffset = Math.sin(t * Math.PI) * (strokeIdx % 2 === 0 ? 1.8 : -1.8);
        // Slight slant + positional shift + 0.85x scale
        const slantedX = 50 + (bx - 50) * 0.85 + (by - 50) * slantTan * 0.35 + curveOffset + 4;
        const slantedY = 50 + (by - 50) * 0.85 + curveOffset * 0.5 - 3;
        densePoints.push([
          Math.max(2, Math.min(98, slantedX)),
          Math.max(2, Math.min(98, slantedY)),
        ]);
      }
    }
    return densePoints;
  });
}

async function runSsimTests() {
  console.log("======================================================================");
  console.log("HANDWRITING-TOLERANT SSIM PIXEL DIFFERENCE & ROUTING UNIT TESTS");
  console.log("======================================================================\n");

  // -------------------------------------------------------------------------
  // Test 1: Complete Character with Natural Handwriting Curvature, Slant & Offset
  // -------------------------------------------------------------------------
  console.log(
    "[Test 1] Complete character ('木', '王') with natural handwriting curvature, slant, thickness & scale variations"
  );
  const curvedMuPolylines = applyNaturalHandwritingVariation(CHAR_GLYPH_STROKES["木"]);
  // Render at a non-standard canvas size (160x160) and thinner stroke radius (2.6) to test normalization
  const curvedMuCanvas = renderGlyphPolylinesToRgba(curvedMuPolylines, 160, 160, 2.6);
  const curvedMuResult = evaluateStrokeDifference(curvedMuCanvas, "木");

  console.log(
    `  -> Complete curved '木' result: ${JSON.stringify(curvedMuResult)}`
  );
  assert.equal(curvedMuResult.hasMissingStrokes, false);
  assert.ok(
    curvedMuResult.missingPercentage <= 35,
    `Expected missingPercentage <= 35 for natural curved handwriting, got ${curvedMuResult.missingPercentage}`
  );
  assert.equal(curvedMuResult.missingRegion, "none");

  const curvedWangPolylines = applyNaturalHandwritingVariation(CHAR_GLYPH_STROKES["王"]);
  const curvedWangCanvas = renderGlyphPolylinesToRgba(curvedWangPolylines, 180, 180, 2.8);
  const curvedWangResult = evaluateStrokeDifference(curvedWangCanvas, "王");

  console.log(
    `  -> Complete curved '王' result: ${JSON.stringify(curvedWangResult)}`
  );
  assert.equal(curvedWangResult.hasMissingStrokes, false);
  assert.ok(curvedWangResult.missingPercentage <= 35);
  assert.equal(curvedWangResult.missingRegion, "none");
  console.log(
    "  -> PASS: Natural handwriting curvature, slant, and scaling variations do NOT trigger false positives\n"
  );

  // -------------------------------------------------------------------------
  // Test 2: Character Missing a Major Structural Line (e.g. 木 missing horizontal top bar)
  // -------------------------------------------------------------------------
  console.log(
    "[Test 2] Character missing a major structural line ('木' missing horizontal top bar, '王' missing top bar, '日' missing middle bar)"
  );

  // "木" strokes: [0] horizontal top bar [[14, 36], [86, 36]], [1] vertical, [2] left leg, [3] right leg
  const muMissingTopBarStrokes = CHAR_GLYPH_STROKES["木"].slice(1);
  const muMissingTopBarCanvas = renderGlyphPolylinesToRgba(
    muMissingTopBarStrokes,
    200,
    200
  );
  const muMissingTopBarResult = evaluateStrokeDifference(
    muMissingTopBarCanvas,
    "木"
  );

  console.log(
    `  -> '木' missing horizontal top bar: ${JSON.stringify(muMissingTopBarResult)}`
  );
  assert.equal(muMissingTopBarResult.hasMissingStrokes, true);
  assert.ok(
    muMissingTopBarResult.missingPercentage > 35,
    `Expected missingPercentage > 35 for '木' missing horizontal top bar, got ${muMissingTopBarResult.missingPercentage}`
  );
  assert.equal(muMissingTopBarResult.missingRegion, "top-horizontal");

  // "王" missing top horizontal bar (stroke [0])
  const wangMissingTopStrokes = CHAR_GLYPH_STROKES["王"].slice(1);
  const wangMissingTopCanvas = renderGlyphPolylinesToRgba(
    wangMissingTopStrokes,
    200,
    200
  );
  const wangMissingTopResult = evaluateStrokeDifference(
    wangMissingTopCanvas,
    "王"
  );

  console.log(
    `  -> '王' missing top horizontal bar: ${JSON.stringify(wangMissingTopResult)}`
  );
  assert.equal(wangMissingTopResult.hasMissingStrokes, true);
  assert.ok(wangMissingTopResult.missingPercentage > 35);
  assert.equal(wangMissingTopResult.missingRegion, "top-horizontal");

  // "日" missing middle horizontal bar (stroke [2])
  const riMissingMiddleStrokes = CHAR_GLYPH_STROKES["日"].filter(
    (_, idx) => idx !== 2
  );
  const riMissingMiddleCanvas = renderGlyphPolylinesToRgba(
    riMissingMiddleStrokes,
    200,
    200
  );
  const riMissingMiddleResult = evaluateStrokeDifference(
    riMissingMiddleCanvas,
    "日"
  );

  console.log(
    `  -> '日' missing middle horizontal bar: ${JSON.stringify(riMissingMiddleResult)}`
  );
  assert.equal(riMissingMiddleResult.hasMissingStrokes, true);
  assert.ok(riMissingMiddleResult.missingPercentage > 35);
  assert.equal(riMissingMiddleResult.missingRegion, "middle-horizontal");
  console.log(
    "  -> PASS: Missing major structural strokes accurately return hasMissingStrokes: true (> 35% threshold)\n"
  );

  // -------------------------------------------------------------------------
  // Test 3: Conditional Routing — Tier 1 (>= 0.90) + LLM Contextual Hint
  // -------------------------------------------------------------------------
  console.log(
    "[Test 3] Tier 1 (>= 0.90): Runs SSIM automatically and passes contextual hint to analyzeGrammar()"
  );
  const tier1Fixture = buildHandwritingFixture("木");
  let capturedSystemPrompt = "";

  const tier1Response = await processHandwritingReview(
    {
      imageBase64: tier1Fixture.dataUrl,
      userCanvas: muMissingTopBarCanvas,
      targetChar: "木",
    },
    {
      mockResult: {
        transcription: "木",
        overallConfidence: 0.95,
        characters: [{ character: "木", confidence: 0.95 }],
      },
      llmAnalyzer: async (chineseText, strokeAnalysis, systemInstruction) => {
        capturedSystemPrompt = systemInstruction;
        return analyzeGrammar(chineseText, strokeAnalysis);
      },
    }
  );

  assert.equal(tier1Response.httpStatus, 200);
  assert.equal(tier1Response.body.status, "COMPLETE");
  assert.equal(tier1Response.body.recognizedText, "木");
  assert.equal(tier1Response.body.strokeAnalysis.evaluated, true);
  assert.equal(tier1Response.body.strokeAnalysis.hasMissingStrokes, true);
  assert.equal(
    capturedSystemPrompt,
    `Visual stroke verification detected approx ${muMissingTopBarResult.missingPercentage}% missing pixels for character '木'. Check if structural strokes (horizontal/vertical lines or radicals) are missing, and explain the missing stroke clearly to the learner if verified.`
  );
  assert.equal(
    capturedSystemPrompt,
    buildStrokeVerificationPrompt(
      {
        hasMissingStrokes: true,
        missingPercentage: muMissingTopBarResult.missingPercentage,
      },
      "木"
    )
  );
  console.log(`  -> LLM Hint: "${capturedSystemPrompt}"`);
  console.log(
    "  -> PASS: Tier 1 runs SSIM automatically and attaches exact LLM contextual hint\n"
  );

  // -------------------------------------------------------------------------
  // Test 4: Conditional Routing — Tier 2 (0.60 - 0.89) Deferred SSIM & Tier 3 (< 0.60) Skip
  // -------------------------------------------------------------------------
  console.log(
    "[Test 4] Tier 2 (0.60 - 0.89) defers SSIM until confirmation; Tier 3 (< 0.60) skips SSIM with HTTP 422"
  );
  const tier2Fixture = buildHandwritingFixture("我有三书");

  const tier2Initial = await processHandwritingReview(
    {
      imageBase64: tier2Fixture.dataUrl,
      userCanvas: muMissingTopBarCanvas,
    },
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

  assert.equal(tier2Initial.httpStatus, 200);
  assert.equal(tier2Initial.body.status, "LOW_CONFIDENCE");
  assert.equal(tier2Initial.body.requiresVerification, true);
  assert.equal(tier2Initial.body.strokeAnalysis.evaluated, false);

  const tier2Confirmed = await processHandwritingReview({
    text: "我有三书",
    selectedChar: "木",
    confidence: tier2Initial.body.confidence,
    userCanvas: muMissingTopBarCanvas,
  });

  assert.equal(tier2Confirmed.httpStatus, 200);
  assert.equal(tier2Confirmed.body.status, "COMPLETE");
  assert.equal(tier2Confirmed.body.strokeAnalysis.evaluated, true);
  assert.equal(tier2Confirmed.body.strokeAnalysis.hasMissingStrokes, true);

  const tier3Response = await processHandwritingReview(
    {
      imageBase64: tier2Fixture.dataUrl,
      userCanvas: muMissingTopBarCanvas,
    },
    {
      mockResult: {
        transcription: "我有三书",
        overallConfidence: 0.42,
        characters: [{ character: "我", confidence: 0.42 }],
      },
    }
  );
  assert.equal(tier3Response.httpStatus, 422);
  assert.equal(tier3Response.body.status, "UNREADABLE");
  console.log(
    "  -> PASS: Tier 2 defers SSIM until user disambiguation confirmation; Tier 3 rejects with HTTP 422\n"
  );

  console.log("======================================================================");
  console.log("ALL HANDWRITING-TOLERANT SSIM & ROUTING TESTS PASSED (4 / 4)");
  console.log("======================================================================");
}

runSsimTests().catch((err) => {
  console.error("SSIM test suite failed:", err);
  process.exitCode = 1;
});
