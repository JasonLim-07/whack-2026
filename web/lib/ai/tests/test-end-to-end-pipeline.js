import assert from "node:assert/strict";
import { processHandwritingReview } from "../ocr.js";
import { buildHandwritingFixture, CHAR_GLYPH_STROKES } from "../testFixtures.js";
import { renderGlyphPolylinesToRgba } from "../../utils/ssim.js";

function logScenarioSummary({
  name,
  inputType,
  ocrTier,
  confidence,
  recognizedText,
  candidateOptions,
  strokeAnalysis,
  grammarCorrection,
  passed,
}) {
  console.log("----------------------------------------------------------------------");
  console.log(`Scenario: ${name}`);
  console.log(`- Input Type: ${inputType}`);
  console.log(`- OCR Tier & Confidence: ${ocrTier} (${confidence.toFixed(2)})`);
  console.log(`- Recognized Text: "${recognizedText}"`);
  console.log(`- Candidate Options (if Tier 2): ${candidateOptions}`);
  console.log(
    `- Stroke Analysis: ${
      strokeAnalysis ? JSON.stringify(strokeAnalysis) : "N/A"
    }`
  );
  console.log(`- Final Grammar Correction: ${grammarCorrection}`);
  console.log(`- Test Result: ${passed ? "PASS" : "FAIL"}`);
}

async function runEndToEndPipelineTests() {
  console.log("======================================================================");
  console.log("INKLING END-TO-END AI PIPELINE INTEGRATION TEST SUITE");
  console.log("======================================================================");

  let passedCount = 0;
  const totalScenarios = 4;

  // -------------------------------------------------------------------------
  // Scenario A: Clean Handwriting with Grammar Error (Tier 1 >= 0.90)
  // Input: "我有三书" (Confidence: 0.94)
  // Expected:
  //   - Bypasses candidate UI (requiresVerification: false)
  //   - Runs SSIM immediately (Condition A: strokeAnalysis.evaluated === true)
  //   - Passes "我有三书" directly to analyzeGrammar()
  //   - Grammar engine returns correctedText: "我有三本书" (missing measure word "本")
  // -------------------------------------------------------------------------
  {
    const fixture = buildHandwritingFixture("我有三书");
    const completeShuCanvas = renderGlyphPolylinesToRgba(
      CHAR_GLYPH_STROKES["书"],
      120,
      120
    );

    const response = await processHandwritingReview(
      {
        imageBase64: fixture.dataUrl,
        userCanvas: completeShuCanvas,
        targetChar: "书",
      },
      {
        mockResult: {
          transcription: "我有三书",
          overallConfidence: 0.94,
          characters: [
            { character: "我", confidence: 0.95 },
            { character: "有", confidence: 0.93 },
            { character: "三", confidence: 0.96 },
            { character: "书", confidence: 0.92 },
          ],
        },
      }
    );

    assert.equal(response.httpStatus, 200);
    assert.equal(response.body.status, "COMPLETE");
    assert.equal(response.body.recognizedText, "我有三书");
    assert.equal(response.body.strokeAnalysis.evaluated, true);
    assert.equal(response.body.strokeAnalysis.hasMissingStrokes, false);
    assert.equal(response.body.grammar.hasErrors, true);
    assert.equal(response.body.grammar.correctedText, "我有三本书");
    assert.ok(response.body.grammar.issues.length >= 1);

    passedCount += 1;
    logScenarioSummary({
      name: "Scenario A — Clean Handwriting with Grammar Error (Tier 1)",
      inputType: 'Base64 PNG ("我有三书")',
      ocrTier: "Tier 1 (SUCCESS)",
      confidence: response.body.confidence,
      recognizedText: response.body.recognizedText,
      candidateOptions: "None (Tier 1 bypasses verification UI)",
      strokeAnalysis: response.body.strokeAnalysis,
      grammarCorrection: `"${response.body.grammar.correctedText}" (${response.body.grammar.issues[0].explanation})`,
      passed: true,
    });
  }

  // -------------------------------------------------------------------------
  // Scenario B: Clean & Grammatically Correct Handwriting (Tier 1 >= 0.90)
  // Input: "我是学生" (Confidence: 0.96)
  // Expected:
  //   - status: "COMPLETE", hasErrors: false, issues: []
  // -------------------------------------------------------------------------
  {
    const fixture = buildHandwritingFixture("我是学生");
    const completeWoCanvas = renderGlyphPolylinesToRgba(
      CHAR_GLYPH_STROKES["我"],
      120,
      120
    );

    const response = await processHandwritingReview(
      {
        imageBase64: fixture.dataUrl,
        userCanvas: completeWoCanvas,
        targetChar: "我",
      },
      {
        mockResult: {
          transcription: "我是学生",
          overallConfidence: 0.96,
          characters: [
            { character: "我", confidence: 0.97 },
            { character: "是", confidence: 0.96 },
            { character: "学", confidence: 0.95 },
            { character: "生", confidence: 0.96 },
          ],
        },
      }
    );

    assert.equal(response.httpStatus, 200);
    assert.equal(response.body.status, "COMPLETE");
    assert.equal(response.body.recognizedText, "我是学生");
    assert.equal(response.body.strokeAnalysis.evaluated, true);
    assert.equal(response.body.strokeAnalysis.hasMissingStrokes, false);
    assert.equal(response.body.grammar.hasErrors, false);
    assert.equal(response.body.grammar.correctedText, "我是学生");
    assert.deepEqual(response.body.grammar.issues, []);

    passedCount += 1;
    logScenarioSummary({
      name: "Scenario B — Clean & Grammatically Correct Handwriting (Tier 1)",
      inputType: 'Base64 PNG ("我是学生")',
      ocrTier: "Tier 1 (SUCCESS)",
      confidence: response.body.confidence,
      recognizedText: response.body.recognizedText,
      candidateOptions: "None (Tier 1 bypasses verification UI)",
      strokeAnalysis: response.body.strokeAnalysis,
      grammarCorrection: `"${response.body.grammar.correctedText}" (hasErrors: false, issues: [])`,
      passed: true,
    });
  }

  // -------------------------------------------------------------------------
  // Scenario C: Ambiguous / Messy Character (Tier 2: 0.60 – 0.89)
  // Step 1: Initial image submission returns requiresVerification: true,
  //         characterCandidates with context-ranked options ("本" at index 0),
  //         and strokeAnalysis.evaluated === false (Condition B).
  // Step 2: Simulated user confirmation ({ text: "我有三书", selectedChar: "书" })
  //         triggers SSIM and analyzeGrammar() -> returns correctedText: "我有三本书".
  // -------------------------------------------------------------------------
  {
    const fixture = buildHandwritingFixture("我有三书");
    const completeShuCanvas = renderGlyphPolylinesToRgba(
      CHAR_GLYPH_STROKES["书"],
      120,
      120
    );

    const step1 = await processHandwritingReview(
      {
        imageBase64: fixture.dataUrl,
        userCanvas: completeShuCanvas,
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

    assert.equal(step1.httpStatus, 200);
    assert.equal(step1.body.status, "LOW_CONFIDENCE");
    assert.equal(step1.body.requiresVerification, true);
    assert.equal(step1.body.strokeAnalysis.evaluated, false);
    assert.equal(step1.body.characterCandidates.length, 1);
    assert.equal(step1.body.characterCandidates[0].options[0].char, "本");
    assert.equal(
      step1.body.characterCandidates[0].options[0].reason,
      "Rank #1: Best grammatical context fit"
    );
    assert.equal(step1.body.characterCandidates[0].options[1].char, "书");

    // Simulate user selecting their literal written attempt ("书") in the UI disambiguation panel
    const step2 = await processHandwritingReview({
      text: "我有三书",
      selectedChar: "书",
      confidence: step1.body.confidence,
      userCanvas: completeShuCanvas,
    });

    assert.equal(step2.httpStatus, 200);
    assert.equal(step2.body.status, "COMPLETE");
    assert.equal(step2.body.recognizedText, "我有三书");
    assert.equal(step2.body.strokeAnalysis.evaluated, true);
    assert.equal(step2.body.grammar.hasErrors, true);
    assert.equal(step2.body.grammar.correctedText, "我有三本书");

    passedCount += 1;
    logScenarioSummary({
      name: "Scenario C — Ambiguous Character Disambiguation + Post-Confirm SSIM (Tier 2)",
      inputType: 'Base64 PNG ("我有三[书/本]") -> Confirmed "我有三书"',
      ocrTier: "Tier 2 (LOW_CONFIDENCE -> COMPLETE)",
      confidence: step1.body.confidence,
      recognizedText: `${step1.body.recognizedText} (contextual) / ${step2.body.recognizedText} (confirmed)`,
      candidateOptions: JSON.stringify(
        step1.body.characterCandidates[0].options.map((o) => o.char)
      ),
      strokeAnalysis: step2.body.strokeAnalysis,
      grammarCorrection: `"${step2.body.grammar.correctedText}" (${step2.body.grammar.issues[0].explanation})`,
      passed: true,
    });
  }

  // -------------------------------------------------------------------------
  // Scenario D: Illegible Scribble (Tier 3 < 0.60)
  // Expected:
  //   - Returns HTTP 422 with status: "UNREADABLE"
  //   - Does NOT invoke SSIM or analyzeGrammar()
  // -------------------------------------------------------------------------
  {
    const fixture = buildHandwritingFixture("我是学生");
    let grammarCalled = false;

    const response = await processHandwritingReview(
      {
        imageBase64: fixture.dataUrl,
      },
      {
        mockResult: {
          transcription: "我是学生",
          overallConfidence: 0.35,
          characters: [
            { character: "我", confidence: 0.32 },
            { character: "是", confidence: 0.38 },
            { character: "学", confidence: 0.35 },
            { character: "生", confidence: 0.35 },
          ],
        },
        llmAnalyzer: async () => {
          grammarCalled = true;
          return { hasErrors: false, correctedText: "", issues: [] };
        },
      }
    );

    assert.equal(response.httpStatus, 422);
    assert.equal(response.body.status, "UNREADABLE");
    assert.equal(response.body.recognizedText, "");
    assert.equal(response.body.requiresVerification, false);
    assert.equal(grammarCalled, false);

    passedCount += 1;
    logScenarioSummary({
      name: "Scenario D — Illegible Scribble Rejection (Tier 3)",
      inputType: "Base64 PNG (noisy scribble)",
      ocrTier: "Tier 3 (UNREADABLE / HTTP 422)",
      confidence: response.body.confidence,
      recognizedText: response.body.recognizedText,
      candidateOptions: "None",
      strokeAnalysis: null,
      grammarCorrection: "Skipped (rejected at Tier 3 with HTTP 422)",
      passed: true,
    });
  }

  console.log("======================================================================");
  console.log(`PIPELINE SUMMARY: ${passedCount} / ${totalScenarios} SCENARIOS PASSED`);
  console.log("======================================================================");
}

runEndToEndPipelineTests().catch((err) => {
  console.error("End-to-end pipeline test failed:", err);
  process.exitCode = 1;
});

