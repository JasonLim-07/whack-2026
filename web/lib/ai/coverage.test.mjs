import assert from "node:assert/strict";
import test from "node:test";
import { handleReview } from "./review.js";
import { POST } from "../../app/api/review/route.js";
import { encodePngRgba } from "./pngUtils.js";
import { checkWritingCoverage } from "./coverage.mjs";
import { validateReview, getConfirmedText, requestConfirmedReview } from "../review/client.mjs";

const left = { x: 10, y: 20, width: 40, height: 60 };
const right = { ...left, x: 110 };
const spatial = {
  width: 200, height: 100, regions: [
    { id: "0:0", row: 0, column: 0, ambiguous: false, bounds: left },
    { id: "0:1", row: 0, column: 1, ambiguous: false, bounds: right },
  ],
};
const pixels = Buffer.alloc(200 * 100 * 4, 255);
for (const box of [left, right]) for (let y = box.y; y < box.y + box.height; y++) {
  for (let x = box.x; x < box.x + box.width; x++) pixels.fill(20, (y * 200 + x) * 4, (y * 200 + x) * 4 + 3);
}
const png = encodePngRgba(200, 100, pixels);
const segment = (text, bounds) => ({ text, confidence: 0.99, bounds });
function upload(metadata = spatial) {
  const form = new FormData();
  form.set("image", new File([png], "controlled.png", { type: "image/png" }));
  form.set("revision", "7");
  if (metadata !== undefined && metadata !== null) form.set("spatial", JSON.stringify(metadata));
  return new Request("http://localhost/api/review", { method: "POST", body: form });
}
function recognition(text = "口未", segments = [segment("口", left), segment("未", right)]) {
  return { text, segments, confidence: null, status: "SUCCESS", requiresVerification: false, characterCandidates: [] };
}
async function run(result, request = upload()) {
  let grammarCalls = 0;
  const response = await handleReview(request, {
    recogniseHandwriting: async () => result,
    analyseGrammar: async (text) => { grammarCalls++; return { correctedText: text, issues: [] }; },
  });
  return { status: response.status, body: await response.json(), grammarCalls };
}

test("two occupied regions with corresponding symbols proceed normally and retain boxes", async () => {
  const result = await run(recognition());
  assert.equal(result.status, 200);
  assert.equal(result.grammarCalls, 1);
  assert.deepEqual(result.body.ocrSegments.map((entry) => entry.bounds), [left, right]);
});

test("one omitted region pauses grammar and preserves the original transcription for editing", async () => {
  const result = await run(recognition("口", [segment("口", left)]));
  assert.equal(result.status, 200);
  assert.equal(result.grammarCalls, 0);
  assert.equal(result.body.requiresTextConfirmation, undefined);
  assert.deepEqual(result.body.intentTargets, [{ id: "missing:0:1", start: 1, end: 1, original: "" }]);
  assert.equal(result.body.recognizedText, "口");
  assert.deepEqual(result.body.unresolvedRegions.map(({ id }) => id), ["0:1"]);
  validateReview(result.body, 7);
  assert.equal(getConfirmedText(result.body, { "missing:0:1": "未" }, undefined, { "missing:0:1": [{ text: "未" }] }), "口未");
});

test("low confidence on a detected symbol stays separate from complete non-detection", async () => {
  const value = recognition();
  value.status = "LOW_CONFIDENCE";
  value.requiresVerification = true;
  value.characterCandidates = [{ position: 1, originalAttempt: "未", confidence: 0.75,
    options: [{ char: "未", reason: "Original" }, { char: "末", reason: "Suggestion" }] }];
  const result = await run(value);
  assert.equal(result.body.requiresVerification, true);
  assert.equal(result.body.requiresTextConfirmation, undefined);
  assert.deepEqual(result.body.characterCandidates, value.characterCandidates);
  assert.equal(result.grammarCalls, 0);
  value.status = "UNREADABLE";
  value.segments[1].confidence = 0.4;
  const low = await run(value);
  assert.equal(low.status, 200);
  assert.deepEqual(low.body.intentTargets, [{ id: "intent:1", start: 1, end: 2, original: "未" }]);
  assert.equal(low.body.characterCandidates.length, 0);
  assert.equal(low.grammarCalls, 0);
});

test("no detections can be clarified when writing metadata exists", async () => {
  const result = await run({ ...recognition("", []), status: "UNREADABLE" });
  assert.equal(result.status, 200);
  assert.equal(result.body.unresolvedRegions.length, 2);
  assert.equal(result.grammarCalls, 0);
  validateReview(result.body, 7);
  assert.equal(getConfirmedText(result.body, { "missing:0:0": "口", "missing:0:1": "未" }, undefined, { "missing:0:0": [{ text: "口" }], "missing:0:1": [{ text: "未" }] }), "口未");
});

test("crossing cells, missing boxes and a detection spanning regions request conservative clarification", async () => {
  const crossed = structuredClone(spatial);
  crossed.regions[0].ambiguous = true;
  for (const [value, metadata] of [
    [recognition(), crossed],
    [recognition("口未", [{ text: "口", confidence: null }, { text: "未", confidence: null }]), spatial],
    [recognition("口", [segment("口", { x: 10, y: 20, width: 140, height: 60 })]), spatial],
    [recognition("未口", [segment("未", right), segment("口", left)]), spatial],
  ]) {
    const result = await run(value, upload(metadata));
    assert.equal(result.body.requiresTextConfirmation, true);
    assert.equal(result.grammarCalls, 0);
    assert.equal(result.body.recognizedText, value.text);
  }
});

test("punctuation and tiny unmatched marks are not declared definitely missing Chinese characters", async () => {
  const metadata = structuredClone(spatial);
  metadata.regions[1].bounds = { x: 110, y: 20, width: 3, height: 3 };
  const punctuation = await run(recognition("口。", [segment("口", left), segment("。", metadata.regions[1].bounds)]), upload(metadata));
  assert.equal(punctuation.grammarCalls, 1);
  const stray = await run(recognition("口", [segment("口", left)]), upload(metadata));
  assert.equal(stray.grammarCalls, 0);
  assert.match(stray.body.clarificationMessage, /what.*mean/i);
  assert.doesNotMatch(stray.body.clarificationMessage, /missing character|grid/i);
  assert.equal(stray.body.recognizedText, "口");
});

test("legacy uploads without metadata keep working", async () => {
  const form = new FormData();
  form.set("image", new File([png], "legacy.png", { type: "image/png" }));
  const result = await run(recognition("口", [{ text: "口", confidence: null }]),
    new Request("http://localhost/api/review", { method: "POST", body: form }));
  assert.equal(result.grammarCalls, 1);
  assert.equal(checkWritingCoverage(undefined, []), null);
});

test("English-only, full-width Latin and mixed-script OCR are preserved and paused before grammar", async () => {
  for (const text of ["Hello", "Ｈｅｌｌｏ", "café", "我有Hello书。", "我用 iPhone。", "ABC，。！"]) {
    const result = await run(recognition(text, []), upload(null));
    assert.equal(result.status, 200);
    assert.equal(result.grammarCalls, 0);
    assert.equal(result.body.requiresTextConfirmation, undefined);
    assert.ok(result.body.intentTargets.length > 0);
    assert.equal(result.body.recognizedText, text);
  }
});

test("English-only JSON is rejected, while explicitly confirmed mixed text is allowed", async () => {
  for (const text of ["Hello", "Hello，。！", "我用iPhone。", "我有三书。", "你好，世界！"]) {
    const result = await run(null, new Request("http://localhost/api/review", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
    }));
    const english = !text.includes("我") && !text.includes("你好");
    assert.equal(result.status, english ? 400 : 200);
    assert.equal(result.grammarCalls, english ? 0 : 1);
    if (english) assert.equal(result.body.error.code, "EXPECTED_CHINESE_TEXT");
    else assert.equal(result.body.recognizedText, text);
  }
});

test("clarification followed by frontend JSON confirmation bypasses OCR and produces grammar feedback", async () => {
  const pending = await run(recognition("我", [segment("我", left)]));
  const text = getConfirmedText(pending.body, { "missing:0:1": "有三书。" }, undefined, { "missing:0:1": [{ text: "有三书。" }] });
  let calls = 0;
  const result = await requestConfirmedReview(text, 7, undefined, async (_, init) => handleReview(new Request("http://localhost/api/review", init), {
    recogniseHandwriting: async () => { throw new Error("OCR must not run"); },
    analyseGrammar: async (value) => {
      calls++;
      assert.equal(value, "我有三书。");
      return { correctedText: "我有三本书。", issues: [{ id: "measure", type: "grammar", original: "三书", replacement: "三本书", explanation: "Use 本 for books." }] };
    },
  }));
  assert.equal(result.correctedText, "我有三本书。");
  assert.equal(calls, 1);
  await assert.rejects(requestConfirmedReview("Hello", 7), /Chinese characters/);
});

test("invalid or dimension-mismatched spatial metadata is rejected before providers", async () => {
  for (const metadata of [{}, { ...spatial, width: 201 }, { ...spatial, regions: [] },
    { ...spatial, regions: [{ ...spatial.regions[0], bounds: { ...left, x: -1 } }] }]) {
    const result = await run(null, upload(metadata));
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "INVALID_SPATIAL_METADATA");
    assert.equal(result.grammarCalls, 0);
  }
});

test("actual POST retains raw provider boxes and stops before Gemini on spatial omission", async (t) => {
  const previous = process.env;
  process.env = { ...process.env, OCR_PROVIDER: "vision", OCR_API_KEY: "fake-test-key" };
  t.after(() => { process.env = previous; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /^https:\/\/vision\.googleapis\.com/);
    calls++;
    return Response.json({ responses: [{ fullTextAnnotation: { text: "口", pages: [{ blocks: [{ paragraphs: [{ words: [{ symbols: [{
      text: "口", confidence: 0.99, boundingBox: { vertices: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 80 }, { x: 10, y: 80 }] },
    }] }] }] }] }] } }] });
  });
  const response = await POST(upload());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requiresTextConfirmation, undefined);
  assert.deepEqual(body.intentTargets, [{ id: "missing:0:1", start: 1, end: 1, original: "" }]);
  assert.deepEqual(body.ocrSegments[0].bounds, left);
  assert.equal(body.unresolvedRegions[0].id, "0:1");
  assert.equal(calls, 1);
});
