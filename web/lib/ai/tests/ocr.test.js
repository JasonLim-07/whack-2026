import test from "node:test";
import assert from "node:assert/strict";
import {
  buildThreeTierOcrResponse,
  getVisualCharacterOptions,
  rankVisualCandidatesByContext,
  recognizeHandwriting,
} from "../ocr.js";
import { buildHandwritingFixture } from "../testFixtures.js";

test("Tier 1 (High Confidence >= 0.90): preserves literal text WITHOUT context re-ranking", async () => {
  const fixture = buildHandwritingFixture("我有三书");
  const res = await recognizeHandwriting(fixture.dataUrl, {
    mockResult: {
      transcription: "我有三书",
      overallConfidence: 0.95,
      characters: [
        { character: "我", confidence: 0.96 },
        { character: "有", confidence: 0.94 },
        { character: "三", confidence: 0.98 },
        { character: "书", confidence: 0.92 },
      ],
    },
  });

  assert.equal(res.status, "SUCCESS");
  assert.equal(res.text, "我有三书");
  assert.equal(res.recognizedText, "我有三书");
  assert.equal(res.confidence, 0.95);
  assert.equal(res.requiresVerification, false);
  assert.deepEqual(res.characterCandidates, []);
});

test("Tier 2 (Medium Confidence 0.60 - 0.89): re-ranks visual candidates by grammatical context and retains written attempt", async () => {
  const fixture = buildHandwritingFixture("我有三书");
  const res = await recognizeHandwriting(fixture.dataUrl, {
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
  });

  assert.equal(res.status, "LOW_CONFIDENCE");
  assert.equal(res.confidence, 0.86);
  assert.equal(res.requiresVerification, true);
  assert.equal(res.recognizedText, "我有三本");
  assert.equal(res.text, "我有三书");
  assert.equal(res.characterCandidates.length, 1);

  assert.equal(res.characterCandidates[0].position, 3);
  assert.deepEqual(res.characterCandidates[0].options, [
    { char: "本", reason: "Rank #1: Best grammatical context fit" },
    { char: "书", reason: "Rank #2: Visual stroke match" },
    { char: "韦", reason: "Rank #3: Visual stroke match" },
  ]);
});

test("Tier 2 context re-ranking resolves visual confusion in compound words (我是字生 -> 我是学生, 今夫 -> 今天)", () => {
  // "我是字生": position 2 has visual candidates ["字", "学", "子"]; before "生", "学" is Rank #1
  const rankedStudent = rankVisualCandidatesByContext(
    "字",
    ["学", "子"],
    ["我", "是", "字", "生"],
    2
  );
  assert.deepEqual(rankedStudent, [
    { char: "学", reason: "Rank #1: Best grammatical context fit" },
    { char: "字", reason: "Rank #2: Visual stroke match" },
    { char: "子", reason: "Rank #3: Visual stroke match" },
  ]);

  // "今夫": position 1 has visual candidates ["夫", "天", "大"]; after "今", "天" is Rank #1
  const rankedToday = rankVisualCandidatesByContext(
    "夫",
    ["天", "大"],
    ["今", "夫"],
    1
  );
  assert.deepEqual(rankedToday, [
    { char: "天", reason: "Rank #1: Best grammatical context fit" },
    { char: "夫", reason: "Rank #2: Visual stroke match" },
    { char: "大", reason: "Rank #3: Visual stroke match" },
  ]);
});

test("Tier 3 (Low Confidence < 0.60): returns status UNREADABLE, requiresVerification false, and empty text", async () => {
  const fixture = buildHandwritingFixture("我是学生");
  const res = await recognizeHandwriting(fixture.dataUrl, {
    mockResult: {
      transcription: "我是学生",
      overallConfidence: 0.45,
      characters: [
        { character: "我", confidence: 0.4 },
        { character: "是", confidence: 0.5 },
        { character: "学", confidence: 0.42 },
        { character: "生", confidence: 0.48 },
      ],
    },
  });

  assert.equal(res.status, "UNREADABLE");
  assert.equal(res.text, "");
  assert.equal(res.recognizedText, "");
  assert.equal(res.confidence, 0.45);
  assert.equal(res.requiresVerification, false);
  assert.deepEqual(res.characterCandidates, []);
});

test("Unreadable / empty input resolves smoothly to UNREADABLE without throwing", async () => {
  const resEmpty = await recognizeHandwriting("");
  assert.equal(resEmpty.status, "UNREADABLE");
  assert.equal(resEmpty.text, "");
  assert.equal(resEmpty.requiresVerification, false);
  assert.deepEqual(resEmpty.characterCandidates, []);
});

test("getVisualCharacterOptions returns 2-3 visual/structural alternatives without original character", () => {
  const optsWang = getVisualCharacterOptions("王");
  assert.ok(optsWang.length >= 2 && optsWang.length <= 3);
  assert.ok(!optsWang.includes("王"));
  assert.deepEqual(optsWang, ["玉", "主", "工"]);

  const optsShu = getVisualCharacterOptions("书");
  assert.deepEqual(optsShu, ["本", "韦", "弗"]);
});

test("Boundary thresholds (0.90 is SUCCESS, 0.89 is LOW_CONFIDENCE, 0.60 is LOW_CONFIDENCE, 0.59 is UNREADABLE)", () => {
  const at90 = buildThreeTierOcrResponse({
    text: "人",
    confidence: 0.9,
    characters: [{ character: "人", confidence: 0.9 }],
  });
  assert.equal(at90.status, "SUCCESS");

  const at89 = buildThreeTierOcrResponse({
    text: "人",
    confidence: 0.89,
    characters: [{ character: "人", confidence: 0.89 }],
  });
  assert.equal(at89.status, "LOW_CONFIDENCE");
  assert.equal(at89.requiresVerification, true);
  assert.equal(at89.characterCandidates.length, 1);

  const at60 = buildThreeTierOcrResponse({
    text: "人",
    confidence: 0.6,
    characters: [{ character: "人", confidence: 0.6 }],
  });
  assert.equal(at60.status, "LOW_CONFIDENCE");
  assert.equal(at60.requiresVerification, true);

  const at59 = buildThreeTierOcrResponse({
    text: "人",
    confidence: 0.59,
    characters: [{ character: "人", confidence: 0.59 }],
  });
  assert.equal(at59.status, "UNREADABLE");
  assert.equal(at59.text, "");
});
