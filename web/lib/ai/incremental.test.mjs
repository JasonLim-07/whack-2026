import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { POST as recognise } from "../../app/api/recognition/route.js";
import { POST as grammar } from "../../app/api/grammar/route.js";
import { handleRecognition, handleGrammar } from "./review.js";
import { recogniseRegion } from "./reviewOcr.js";
import { validateRecognition } from "../review/transcription.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVXcAAAAASUVORK5CYII=", "base64");
const sentence = "我有两个书。";
const correction = { correctedText: "我有两本书。", issues: [{ id: "measure", type: "grammar", start: 3, end: 4,
  original: "个", replacement: "本", explanation: "Use 本 as the measure word for books." }] };
const pngRequest = (bytes = png, type = "image/png") => {
  const data = new FormData(); data.append("image", new Blob([bytes], { type }), "region.png"); data.append("revision", "7");
  return new Request("http://localhost/api/recognition", { method: "POST", body: data });
};
const textRequest = (text = sentence) => new Request("http://localhost/api/grammar", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ text, level: "gcse", revision: 7 }) });
beforeEach((t) => {
  const previous = process.env;
  process.env = { ...previous, OCR_PROVIDER: "vision", OCR_API_KEY: "test-placeholder", VISION_API_KEY: "test-placeholder",
    GEMINI_API_KEY: "test-placeholder", GOOGLE_API_KEY: "test-placeholder" };
  t.after(() => { process.env = previous; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected provider request"); });
});

test("real region endpoint calls OCR with an abortable transport and never invokes grammar", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++; assert.match(String(url), /vision.googleapis.com/); assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(init.body); assert.deepEqual(Buffer.from(body.requests[0].image.content, "base64"), png);
    return Response.json({ responses: [{ fullTextAnnotation: { text: sentence,
      pages: [{ blocks: [{ paragraphs: [{ words: [{ symbols: Array.from(sentence, (text) => ({ text, confidence: 0.98 })) }] }] }] }] } }] });
  });
  const response = await recognise(pngRequest()); assert.equal(response.status, 200);
  const result = await response.json(); validateRecognition(result, 7);
  assert.equal(result.recognizedText, sentence); assert.equal(result.ocrConfidence, null);
  assert.equal(result.correctedText, undefined); assert.equal(result.issues, undefined); assert.equal(calls, 1);
});

test("real grammar endpoint uses stored text without OCR and supplies GCSE guidance", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.ok(!String(url).includes("vision.googleapis.com"));
    const body = JSON.parse(init.body);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), { text: sentence, level: "gcse" });
    assert.match(body.systemInstruction.parts[0].text, /word order, measure words, particles/);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(correction) }] }, finishReason: "STOP" }] });
  });
  const response = await grammar(textRequest()); assert.equal(response.status, 200);
  const result = await response.json(); assert.deepEqual(result.issues, correction.issues);
  assert.equal(result.recognizedText, sentence); assert.equal(result.correctedText, correction.correctedText);
});

test("endpoints enforce their respective request types and validate malformed/oversized regions", async () => {
  assert.equal((await recognise(textRequest())).status, 400);
  assert.equal((await grammar(pngRequest())).status, 400);
  assert.equal((await recognise(pngRequest(png, "image/jpeg"))).status, 400);
  assert.equal((await recognise(pngRequest(png.subarray(0, 8)))).status, 400);
  const huge = Buffer.from(png); huge.writeUInt32BE(4097, 16);
  assert.equal((await recognise(pngRequest(huge))).status, 413);
});

test("character concerns retain verification instead of premature grammar feedback", async () => {
  const response = await handleRecognition(pngRequest(), { recogniseHandwriting: async () => ({
    text: "末", confidence: null, segments: [{ text: "末", confidence: 0.749 }], characters: [], status: "LOW_CONFIDENCE", requiresVerification: true,
    characterCandidates: [{ position: 0, originalAttempt: "末", confidence: 0.749, options: [{ char: "末", reason: "Original" }, { char: "未", reason: "Alternative" }] }],
  }), analyseGrammar: () => { throw new Error("Must not run grammar"); } });
  const result = await response.json(); assert.equal(result.requiresVerification, true);
  assert.equal(result.issues, undefined); validateRecognition(result, 7);
});

test("a high aggregate recognition result cannot hide an uncertain character segment", async () => {
  const response = await handleRecognition(pngRequest(), { recogniseHandwriting: async () => ({
    text: "我有书", confidence: null, status: "SUCCESS", requiresVerification: false, characters: [], characterCandidates: [],
    segments: [{ text: "我", confidence: 0.99 }, { text: "有", confidence: 0.99 }, { text: "书", confidence: 0.55 }],
  }) });
  const result = await response.json();
  assert.equal(result.requiresVerification, true); assert.equal(result.intentTargets[0].original, "书");
  assert.equal(result.ocrSegments[2].confidence, 0.55); validateRecognition(result, 7);
});

test("gentler automatic policy accepts moderate OCR without changing provider scores", async () => {
  for (const confidence of [0.75, 0.80, 0.899]) {
    const result = await handleRecognition(pngRequest(), { recogniseHandwriting: async () => ({
      text: "末。", confidence: null, status: "LOW_CONFIDENCE", requiresVerification: true, characters: [],
      segments: [{ text: "末", confidence }, { text: "。", confidence: null }],
      characterCandidates: [{ position: 0, originalAttempt: "末", confidence,
        options: [{ char: "末", reason: "Original" }, { char: "未", reason: "Alternative" }] }],
    }) });
    const review = await result.json(); validateRecognition(review, 7);
    assert.equal(review.requiresVerification, false);
    assert.deepEqual(review.characterCandidates, []);
    assert.deepEqual(review.ocrSegments, [{ text: "末", confidence }, { text: "。", confidence: null }]);
    assert.equal(review.ocrConfidence, null);
  }
});

test("missing character scores still require confirmation; punctuation does not", async () => {
  for (const [text, requiresVerification] of [["末", true], ["。", false], [".", false]]) {
    const response = await handleRecognition(pngRequest(), { recogniseHandwriting: async () => ({
      text, confidence: null, status: "LOW_CONFIDENCE", requiresVerification: true, characters: [], segments: [], characterCandidates: [],
    }) });
    const result = await response.json(); validateRecognition(result, 7);
    assert.equal(result.requiresVerification, requiresVerification);
  }
});

test("HTTP-200 empty OCR recovers using the configured Gemini model and requires honest confirmation", async (t) => {
  process.env.GEMINI_MODEL = "configured-working-model";
  process.env.GEMINI_OCR_MODEL = "";
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).includes("vision.googleapis.com")) { calls.push("vision"); return Response.json({ responses: [{}] }); }
    calls.push("gemini"); assert.match(String(url), /configured-working-model/);
    assert.ok(body.contents[0].parts.some((part) => part.inlineData));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      transcription: "弟", overallConfidence: 0.99,
      characters: [{ character: "弟", confidence: 0.99, box2d: [100,100,900,900] }],
    }) }] } }] });
  });
  const response = await recognise(pngRequest()); const result = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(calls, ["vision", "gemini"]);
  assert.equal(result.recognizedText, "弟"); assert.equal(result.requiresTextConfirmation, true);
  assert.equal(result.ocrConfidence, null); assert.equal(result.ocrSegments[0].confidence, null);
  assert.equal(result.issues, undefined); validateRecognition(result, 7);
});

test("OCR deadline and explicit cancellation bound provider work", async (t) => {
  t.mock.method(globalThis, "fetch", async (_, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  // Keep the loop alive while the unref'd AbortSignal deadline expires.
  const keepAlive = setTimeout(() => {}, 100);
  await assert.rejects(recogniseRegion(png, { timeoutMs: 5 }), /timeout|aborted/i);
  clearTimeout(keepAlive);
  await assert.rejects(recogniseRegion(png, { signal: AbortSignal.abort() }), /abort/i);
});

test("text grammar handles GCSE errors and valid alternatives with exact Unicode ranges", async () => {
  const cases = [
    ["我你爱。", "我爱你。", "你爱", "爱你", 1, 3, "grammar"],
    ["我有三书。", "我有三本书。", "", "本", 3, 3, "grammar"],
    ["他昨天不去学校。", "他昨天没去学校。", "不", "没", 3, 4, "grammar"],
    ["你是学生吗吗？", "你是学生吗？", "吗", "", 5, 6, "grammar"],
    ["我喜欢未饭。", "我喜欢米饭。", "未", "米", 3, 4, "character"],
  ];
  for (const [text, correctedText, original, replacement, start, end, type] of cases) {
    const issue = { id: "one", type, original, replacement, start, end, explanation: "A concise GCSE grammar explanation." };
    const response = await handleGrammar(textRequest(text), { analyseGrammar: async () => ({ correctedText, issues: [issue] }) });
    assert.equal(response.status, 200, text); assert.deepEqual((await response.json()).issues, [issue]);
  }
  for (const text of ["我是学生。", "我在学校学习。", "我学习中文。", "昨天我去了学校。"] ) {
    const result = await handleGrammar(textRequest(text), { analyseGrammar: async () => ({ correctedText: text, issues: [] }) });
    assert.deepEqual((await result.json()).issues, []);
  }
});
