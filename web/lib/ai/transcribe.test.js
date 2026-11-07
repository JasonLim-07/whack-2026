import test from "node:test";
import assert from "node:assert/strict";
import {
  clearTranscriptionCache,
  normalizeOcrResult,
  prepareRecognitionInput,
  transcribeHandwriting,
} from "./transcribe.js";
import {
  clusterStrokesIntoCharacters,
  renderStrokesToPng,
} from "./pngUtils.js";
import { BENCHMARK_CASES, buildHandwritingFixture } from "./testFixtures.js";

test("renders structured strokes to a valid PNG and clusters character regions", () => {
  const fixture = buildHandwritingFixture("我有三书。");

  assert.ok(Buffer.isBuffer(fixture.pngBuffer));
  assert.ok(fixture.pngBuffer.length > 100);
  // Check PNG magic header
  assert.equal(fixture.pngBuffer[0], 0x89);
  assert.equal(fixture.pngBuffer[1], 0x50);
  assert.equal(fixture.pngBuffer[2], 0x4e);
  assert.equal(fixture.pngBuffer[3], 0x47);

  const clusters = clusterStrokesIntoCharacters(fixture.writing.strokes);
  assert.equal(clusters.length, 5); // 我, 有, 三, 书, 。
  assert.ok(clusters[0].strokeIds.length > 0);
  assert.ok(clusters[0].bounds.width > 0);
  assert.ok(clusters[0].bounds.x < clusters[1].bounds.x);
});

test("preserves grammar mistakes literally (我有三书。 and 我你爱。) without silent auto-correction", async () => {
  clearTranscriptionCache();
  const fixture = buildHandwritingFixture("我有三书。");

  // Even if an LLM tried to hallucinate '我有三本书。' in the summary string,
  // our slot-first normalizer enforces the literal physical character slots.
  const mockApiPayload = {
    transcription: "我有三本书。",
    overallConfidence: 0.94,
    characters: [
      { character: "我", confidence: 0.98, box2d: [100, 50, 800, 200] },
      { character: "有", confidence: 0.95, box2d: [100, 220, 800, 380] },
      { character: "三", confidence: 0.99, box2d: [100, 400, 800, 550] },
      {
        character: "书",
        confidence: 0.84,
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
      fetchImpl: fakeFetch,
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.transcription, "我有三书。");
  assert.equal(result.language, "zh");
  assert.equal(result.characters.length, 5);
  assert.equal(result.characters[3].character, "书");
  assert.equal(result.characters[3].formNote, "Outer hook slightly shaky");
  assert.ok(Array.isArray(result.characters[3].strokeIds));
  assert.ok(result.characters[3].bounds.width > 0);

  // Calling again with identical image hits the cache and makes 0 additional API requests
  const cachedResult = await transcribeHandwriting(
    {
      image: fixture.dataUrl,
      writing: fixture.writing,
    },
    {
      apiKey: "test-key",
      fetchImpl: fakeFetch,
    }
  );
  assert.equal(fetchCallCount, 1);
  assert.deepEqual(cachedResult, result);
});

test("supports all 4 benchmark cases and strokes-only fallback input", async () => {
  for (const bench of BENCHMARK_CASES) {
    const fixture = buildHandwritingFixture(bench.sentence, {
      wobble: bench.wobble,
    });

    // Pass only structured writing (no pre-rendered PNG) to verify server-side stroke rendering
    const prepared = prepareRecognitionInput({ writing: fixture.writing });
    assert.ok(prepared.image.base64.length > 100);

    const mockResult = {
      transcription: bench.sentence,
      overallConfidence: 0.92,
      characters: Array.from(bench.sentence).map((ch) => ({
        character: ch,
        confidence: 0.92,
      })),
    };

    const res = await transcribeHandwriting(
      { writing: fixture.writing },
      { mockResult }
    );

    assert.equal(res.success, true);
    assert.equal(res.transcription, bench.sentence);
    assert.equal(res.characters.length, Array.from(bench.sentence).length);
  }
});

test("rejects empty or invalid inputs with descriptive status codes", async () => {
  await assert.rejects(
    () => transcribeHandwriting(null),
    (err) => err.code === "INVALID_INPUT" && err.status === 400
  );

  await assert.rejects(
    () => transcribeHandwriting({ strokes: [] }),
    (err) => err.code === "EMPTY_HANDWRITING" && err.status === 400
  );

  assert.throws(
    () => renderStrokesToPng([]),
    /Cannot render empty strokes/
  );
});

test("normalizes box2d coordinates when only a PNG is supplied without strokes", () => {
  const normalized = normalizeOcrResult(
    {
      transcription: "我你爱。",
      overallConfidence: 0.91,
      characters: [
        { character: "我", confidence: 0.95, box2d: [200, 100, 700, 250] },
        { character: "你", confidence: 0.9, box2d: [200, 300, 700, 450] },
        { character: "爱", confidence: 0.88, box2d: [200, 500, 700, 650] },
        { character: "。", confidence: 0.95, box2d: [600, 680, 720, 730] },
      ],
    },
    { canvas: { width: 800, height: 400 } }
  );

  assert.equal(normalized.transcription, "我你爱。");
  assert.deepEqual(normalized.characters[0].bounds, {
    x: 80,
    y: 80,
    width: 120,
    height: 200,
  });
});
