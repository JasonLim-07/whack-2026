import test from "node:test";
import assert from "node:assert/strict";
import {
  clearTranscriptionCache,
  normalizeOcrResult,
  parseConfidence,
  prepareRecognitionInput,
  transcribeHandwriting,
} from "./transcribe.js";
import {
  clusterStrokesIntoCharacters,
  normalizeImageInput,
  renderStrokesToPng,
} from "./pngUtils.js";
import { BENCHMARK_CASES, buildHandwritingFixture } from "./testFixtures.js";
import { computeCharAccuracy, levenshteinDistance } from "./runBenchmark.js";

test("1. renders structured strokes to a valid PNG and clusters character regions", () => {
  const fixture = buildHandwritingFixture("我有三书。");

  assert.ok(Buffer.isBuffer(fixture.pngBuffer));
  assert.ok(fixture.pngBuffer.length > 100);
  assert.equal(fixture.pngBuffer[0], 0x89);
  assert.equal(fixture.pngBuffer[1], 0x50);
  assert.equal(fixture.pngBuffer[2], 0x4e);
  assert.equal(fixture.pngBuffer[3], 0x47);

  const clusters = clusterStrokesIntoCharacters(fixture.writing.strokes);
  assert.equal(clusters.length, 5);
  assert.ok(clusters[0].strokeIds.length > 0);
  assert.ok(clusters[0].bounds.width > 0);
  assert.ok(clusters[0].bounds.x < clusters[1].bounds.x);
});

test("2. clusters stacked horizontal strokes (一二三个人。) into exact character count", () => {
  const fixture = buildHandwritingFixture("一二三个人。");
  const clusters = clusterStrokesIntoCharacters(fixture.writing.strokes);
  assert.equal(clusters.length, 6);
  assert.equal(clusters[0].strokeIds.length, 1);
  assert.equal(clusters[1].strokeIds.length, 2);
  assert.equal(clusters[2].strokeIds.length, 3);
});

test("3. sorts multi-line handwritten paragraphs in top-to-bottom, left-to-right reading order", () => {
  const fixture = buildHandwritingFixture("我是学生，\n我爱中文。");
  const clusters = clusterStrokesIntoCharacters(fixture.writing.strokes);
  assert.equal(clusters.length, 10);
  assert.ok(clusters[0].bounds.y + 40 < clusters[5].bounds.y);
  assert.ok(clusters[0].bounds.x < clusters[1].bounds.x);
  assert.ok(clusters[5].bounds.x < clusters[6].bounds.x);
});

test("4. handles shaky mouse tremor, slant, and variable character scales without crashing", () => {
  const fixture = buildHandwritingFixture("我今天去了学校。", {
    jitter: 1.5,
    slant: 0.14,
    wobble: 10,
    scalePattern: [1.25, 0.78, 1.15, 0.85],
  });
  assert.ok(fixture.pngBuffer.length > 200);
  assert.ok(fixture.writing.strokes.length > 20);
});

test("5. preserves grammar mistakes literally and returns full required schema (text, originalText, uncertainCharacters, provider)", async () => {
  clearTranscriptionCache();
  const fixture = buildHandwritingFixture("我有三书。");

  const mockApiPayload = {
    transcription: "我有三本书。",
    overallConfidence: 0.94,
    characters: [
      { character: "我", confidence: 0.98, box2d: [100, 50, 800, 200] },
      { character: "有", confidence: 0.95, box2d: [100, 220, 800, 380] },
      { character: "三", confidence: 0.99, box2d: [100, 400, 800, 550] },
      {
        character: "书",
        confidence: 0.72,
        box2d: [100, 580, 800, 740],
        formNote: "Outer hook slightly shaky",
      },
      { character: "。", confidence: 0.96, box2d: [650, 760, 820, 820] },
    ],
  };

  let fetchCallCount = 0;
  const fakeFetch = async () => {
    fetchCallCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(mockApiPayload) }],
            },
          },
        ],
      }),
    };
  };

  const result = await transcribeHandwriting(
    {
      image: fixture.dataUrl,
      writing: fixture.writing,
    },
    {
      apiKey: "test-key",
      provider: "gemini",
      fetchImpl: fakeFetch,
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.text, "我有三书。");
  assert.equal(result.originalText, "我有三书。");
  assert.equal(result.transcription, "我有三书。");
  assert.equal(result.provider, "gemini-vision");
  assert.equal(result.language, "zh");
  assert.equal(result.characters.length, 5);
  assert.equal(result.characters[0].uncertain, false);
  assert.equal(result.characters[3].character, "书");
  assert.equal(result.characters[3].confidence, 0.72);
  assert.equal(result.characters[3].uncertain, true);
  assert.equal(result.uncertainCharacters.length, 1);
  assert.equal(result.uncertainCharacters[0].character, "书");
  assert.equal(result.uncertainCharacters[0].index, 3);

  // Cache hit verification
  const cachedResult = await transcribeHandwriting(
    {
      image: fixture.dataUrl,
      writing: fixture.writing,
    },
    {
      apiKey: "test-key",
      provider: "gemini",
      fetchImpl: fakeFetch,
    }
  );
  assert.equal(fetchCallCount, 1);
  assert.deepEqual(cachedResult, result);
});

test("6. never fabricates confidence scores when missing (uses null and flags uncertain)", () => {
  assert.equal(parseConfidence(undefined), null);
  assert.equal(parseConfidence(null), null);
  assert.equal(parseConfidence(NaN), null);
  assert.equal(parseConfidence("0.9"), null);
  assert.equal(parseConfidence(0.876), 0.88);

  const normalized = normalizeOcrResult({
    transcription: "我是",
    characters: [
      { character: "我" }, // missing confidence
      { character: "是", confidence: null }, // explicit null confidence
    ],
  });

  assert.equal(normalized.confidence, null);
  assert.equal(normalized.characters[0].confidence, null);
  assert.equal(normalized.characters[0].uncertain, true);
  assert.equal(normalized.characters[1].confidence, null);
  assert.equal(normalized.characters[1].uncertain, true);
  assert.equal(normalized.uncertainCharacters.length, 2);
  assert.equal(normalized.uncertainCharacters[0].reason, "missing_confidence");
});

test("7. flags low-confidence characters using configurable uncertaintyThreshold (default 0.80)", () => {
  const raw = {
    transcription: "我愛你",
    characters: [
      { character: "我", confidence: 0.95 },
      { character: "愛", confidence: 0.79 },
      { character: "你", confidence: 0.8 },
    ],
  };

  const defaultRes = normalizeOcrResult(raw);
  assert.equal(defaultRes.characters[0].uncertain, false);
  assert.equal(defaultRes.characters[1].uncertain, true);
  assert.equal(defaultRes.characters[2].uncertain, false);
  assert.equal(defaultRes.uncertainCharacters.length, 1);
  assert.equal(defaultRes.uncertainCharacters[0].character, "愛");

  const strictRes = normalizeOcrResult(raw, { uncertaintyThreshold: 0.9 });
  assert.equal(strictRes.uncertainCharacters.length, 2);
});

test("8. disambiguates '0' to '口' ONLY with strong evidence, preserving originalCharacter and originalText", () => {
  const fixture = buildHandwritingFixture("口日目。");
  const clusters = clusterStrokesIntoCharacters(fixture.writing.strokes);

  // Case A: Strong evidence (3 strokes, square box, low confidence 0.54, CJK neighbor) -> converts to 口
  const disambiguated = normalizeOcrResult(
    {
      transcription: "0日目。",
      characters: [
        { character: "0", confidence: 0.54 },
        { character: "日", confidence: 0.95 },
        { character: "目", confidence: 0.95 },
        { character: "。", confidence: 0.95 },
      ],
    },
    { strokeClusters: clusters, language: "zh" }
  );

  assert.equal(disambiguated.text, "口日目。");
  assert.equal(disambiguated.originalText, "0日目。");
  assert.equal(disambiguated.characters[0].character, "口");
  assert.equal(disambiguated.characters[0].originalCharacter, "0");
  assert.equal(disambiguated.characters[0].confidence, 0.54);
  assert.equal(disambiguated.characters[0].uncertain, true);
  assert.equal(disambiguated.characters[0].normalized, true);

  // Case B: High provider confidence (>= 0.85) on "0" -> does NOT override provider
  const highConfZero = normalizeOcrResult(
    {
      transcription: "0日目。",
      characters: [
        { character: "0", confidence: 0.92 },
        { character: "日", confidence: 0.95 },
        { character: "目", confidence: 0.95 },
        { character: "。", confidence: 0.95 },
      ],
    },
    { strokeClusters: clusters, language: "zh" }
  );
  assert.equal(highConfZero.text, "0日目。");

  // Case C: Genuine number "10" in "我有10本书。" -> NEVER converts 0 to 口 because of adjacent digit "1"
  const numFixture = buildHandwritingFixture("我有10本书。");
  const numClusters = clusterStrokesIntoCharacters(numFixture.writing.strokes);
  const genuineNumber = normalizeOcrResult(
    {
      transcription: "我有10本书。",
      characters: [
        { character: "我", confidence: 0.98 },
        { character: "有", confidence: 0.97 },
        { character: "1", confidence: 0.95 },
        { character: "0", confidence: 0.65 },
        { character: "本", confidence: 0.96 },
        { character: "书", confidence: 0.94 },
        { character: "。", confidence: 0.98 },
      ],
    },
    { strokeClusters: numClusters, language: "zh" }
  );
  assert.equal(genuineNumber.text, "我有10本书。");

  // Case D: Unaligned cluster count (e.g. PNG-only with 0 strokeClusters) -> does NOT blindly convert 0
  const unaligned = normalizeOcrResult(
    {
      transcription: "0日目。",
      characters: [
        { character: "0", confidence: 0.54 },
        { character: "日", confidence: 0.95 },
        { character: "目", confidence: 0.95 },
        { character: "。", confidence: 0.95 },
      ],
    },
    { strokeClusters: [], language: "zh" }
  );
  assert.equal(unaligned.text, "0日目。");
});

test("9. normalizes Chinese punctuation contextually without corrupting decimals, thousands, or English", () => {
  // Normalizes punctuation adjacent to CJK characters while keeping originalText intact
  const zhResult = normalizeOcrResult({
    transcription: "你好,我是学生!",
    characters: [
      { character: "你", confidence: 0.95 },
      { character: "好", confidence: 0.95 },
      { character: ",", confidence: 0.95 },
      { character: "我", confidence: 0.95 },
      { character: "是", confidence: 0.95 },
      { character: "学", confidence: 0.95 },
      { character: "生", confidence: 0.95 },
      { character: "!", confidence: 0.95 },
    ],
  });
  assert.equal(zhResult.text, "你好，我是学生！");
  assert.equal(zhResult.originalText, "你好,我是学生!");

  // Does NOT corrupt decimal "3.5" or thousands "1,000" inside a Chinese sentence
  const decimalResult = normalizeOcrResult({
    transcription: "我有3.5元.",
    characters: [
      { character: "我", confidence: 0.95 },
      { character: "有", confidence: 0.95 },
      { character: "3", confidence: 0.95 },
      { character: ".", confidence: 0.95 },
      { character: "5", confidence: 0.95 },
      { character: "元", confidence: 0.95 },
      { character: ".", confidence: 0.95 },
    ],
  });
  assert.equal(decimalResult.text, "我有3.5元。");
  assert.equal(decimalResult.originalText, "我有3.5元.");

  // Leaves pure English text untouched (does not convert ',' or '!' to '，' or '！')
  const enResult = normalizeOcrResult({
    transcription: "Hi,world!",
    characters: [
      { character: "H", confidence: 0.95 },
      { character: "i", confidence: 0.95 },
      { character: ",", confidence: 0.95 },
      { character: "w", confidence: 0.95 },
      { character: "o", confidence: 0.95 },
      { character: "r", confidence: 0.95 },
      { character: "l", confidence: 0.95 },
      { character: "d", confidence: 0.95 },
      { character: "!", confidence: 0.95 },
    ],
  });
  assert.equal(enResult.text, "Hi,world!");
});

test("10. Levenshtein character accuracy properly penalizes insertions, deletions, and shifts", () => {
  // Deletion at start: "我是学生。" vs "是学生。" -> distance 1, accuracy 4/5 (0.8), NOT 0/5!
  const shifted = computeCharAccuracy("我是学生。", "是学生。");
  assert.equal(shifted.editDistance, 1);
  assert.equal(shifted.effectiveMatches, 4);
  assert.equal(shifted.maxLength, 5);
  assert.equal(shifted.rate, 0.8);

  // Extra garbage characters at end: "我是学生。" vs "我是学生。哈哈" -> distance 2, accuracy 5/7, NOT 5/5!
  const inserted = computeCharAccuracy("我是学生。", "我是学生。哈哈");
  assert.equal(inserted.editDistance, 2);
  assert.equal(inserted.effectiveMatches, 5);
  assert.equal(inserted.maxLength, 7);
  assert.ok(inserted.rate < 0.72);

  assert.equal(levenshteinDistance("我有三书。", "我有三本书。"), 1);
});

test("11. parses Google Cloud Vision DOCUMENT_TEXT_DETECTION response with symbol confidence and vertices", async () => {
  clearTranscriptionCache();
  const fixture = buildHandwritingFixture("我有三书。");

  const cloudVisionPayload = {
    responses: [
      {
        fullTextAnnotation: {
          text: "我有三书.",
          pages: [
            {
              blocks: [
                {
                  paragraphs: [
                    {
                      words: [
                        {
                          symbols: [
                            {
                              text: "我",
                              confidence: 0.98,
                              boundingBox: {
                                vertices: [
                                  { x: 40, y: 60 },
                                  { x: 100, y: 60 },
                                  { x: 100, y: 120 },
                                  { x: 40, y: 120 },
                                ],
                              },
                            },
                            {
                              text: "有",
                              confidence: 0.96,
                              boundingBox: {
                                vertices: [
                                  { x: 130, y: 60 },
                                  { x: 190, y: 60 },
                                  { x: 190, y: 120 },
                                  { x: 130, y: 120 },
                                ],
                              },
                            },
                            {
                              text: "三",
                              confidence: 0.99,
                              boundingBox: {
                                vertices: [
                                  { x: 220, y: 60 },
                                  { x: 280, y: 60 },
                                  { x: 280, y: 120 },
                                  { x: 220, y: 120 },
                                ],
                              },
                            },
                            {
                              text: "书",
                              confidence: 0.91,
                              boundingBox: {
                                vertices: [
                                  { x: 310, y: 60 },
                                  { x: 370, y: 60 },
                                  { x: 370, y: 120 },
                                  { x: 310, y: 120 },
                                ],
                              },
                            },
                            {
                              text: ".",
                              confidence: 0.95,
                              boundingBox: {
                                vertices: [
                                  { x: 390, y: 100 },
                                  { x: 405, y: 100 },
                                  { x: 405, y: 115 },
                                  { x: 390, y: 115 },
                                ],
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };

  const fakeVisionFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => cloudVisionPayload,
  });

  const result = await transcribeHandwriting(fixture.dataUrl, {
    apiKey: "test-vision-key",
    provider: "vision",
    fetchImpl: fakeVisionFetch,
  });

  assert.equal(result.success, true);
  assert.equal(result.provider, "google-cloud-vision");
  assert.equal(result.text, "我有三书。");
  assert.equal(result.originalText, "我有三书.");
  assert.equal(result.characters.length, 5);
  assert.equal(result.characters[0].character, "我");
  assert.equal(result.characters[0].confidence, 0.98);
  assert.deepEqual(result.characters[0].bounds, {
    x: 40,
    y: 60,
    width: 60,
    height: 60,
  });
});

test("12. handles blank/unreadable Cloud Vision image gracefully (empty text, 0 confidence)", async () => {
  clearTranscriptionCache();
  const fixture = buildHandwritingFixture("一");

  const emptyVisionFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ responses: [{}] }),
  });

  const result = await transcribeHandwriting(fixture.dataUrl, {
    apiKey: "test-vision-key",
    provider: "vision",
    skipCache: true,
    fetchImpl: emptyVisionFetch,
  });

  assert.equal(result.success, true);
  assert.equal(result.text, "");
  assert.equal(result.originalText, "");
  assert.equal(result.confidence, 0);
  assert.equal(result.characters.length, 0);
  assert.equal(result.uncertainCharacters.length, 0);
});

test("13. handles HTTP 429 rate limits and HTTP 503 provider errors with structured error codes", async () => {
  const fixture = buildHandwritingFixture("一");

  const rateLimitFetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: "Quota exceeded" } }),
  });

  await assert.rejects(
    () =>
      transcribeHandwriting(fixture.dataUrl, {
        apiKey: "test-key",
        provider: "vision",
        skipCache: true,
        fetchImpl: rateLimitFetch,
      }),
    (err) => err.code === "RATE_LIMITED" && err.status === 429
  );

  const serverErrorFetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: "Service unavailable" } }),
  });

  await assert.rejects(
    () =>
      transcribeHandwriting(fixture.dataUrl, {
        apiKey: "test-key",
        provider: "vision",
        skipCache: true,
        fetchImpl: serverErrorFetch,
      }),
    (err) => err.code === "PROVIDER_ERROR" && err.status === 502
  );
});

test("14. automatically falls back from Cloud Vision to Gemini Vision in auto mode", async () => {
  clearTranscriptionCache();
  const fixture = buildHandwritingFixture("我你爱。");

  let callIndex = 0;
  const fallbackFetch = async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: { message: "Vision disabled" } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    transcription: "我你爱。",
                    overallConfidence: 0.93,
                    characters: [
                      { character: "我", confidence: 0.95 },
                      { character: "你", confidence: 0.92 },
                      { character: "爱", confidence: 0.91 },
                      { character: "。", confidence: 0.94 },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    };
  };

  const result = await transcribeHandwriting(fixture.dataUrl, {
    apiKey: "test-auto-key",
    provider: "auto",
    skipCache: true,
    fetchImpl: fallbackFetch,
  });

  assert.equal(callIndex, 2);
  assert.equal(result.text, "我你爱。");
  assert.equal(result.provider, "gemini-vision");
});

test("15. supports all 19 benchmark cases with strokes-only fallback input", async () => {
  for (const bench of BENCHMARK_CASES) {
    const fixture = buildHandwritingFixture(bench.sentence, {
      wobble: bench.wobble,
      jitter: bench.jitter,
      slant: bench.slant,
      charSize: bench.charSize,
      charSpacing: bench.charSpacing,
      scalePattern: bench.scalePattern,
    });

    const prepared = prepareRecognitionInput({ writing: fixture.writing });
    assert.ok(prepared.image.base64.length > 100);

    const mockResult = {
      transcription: fixture.expectedText,
      overallConfidence: 0.92,
      characters: Array.from(fixture.expectedText).map((ch) => ({
        character: ch,
        confidence: 0.92,
      })),
    };

    const res = await transcribeHandwriting(
      { writing: fixture.writing },
      { mockResult }
    );

    assert.equal(res.success, true);
    assert.equal(res.text, fixture.expectedText);
    assert.equal(res.characters.length, Array.from(fixture.expectedText).length);
  }
});

test("16. rejects empty or invalid inputs with descriptive status codes", async () => {
  await assert.rejects(
    () => transcribeHandwriting(null),
    (err) => err.code === "INVALID_INPUT" && err.status === 400
  );

  await assert.rejects(
    () => transcribeHandwriting({ strokes: [] }),
    (err) => err.code === "EMPTY_HANDWRITING" && err.status === 400
  );

  assert.throws(() => renderStrokesToPng([]), /Cannot render empty strokes/);
  assert.throws(() => normalizeImageInput("   "), /Image string is empty/);
  assert.throws(
    () => normalizeImageInput(Buffer.alloc(0)),
    /Image buffer is empty/
  );
});
