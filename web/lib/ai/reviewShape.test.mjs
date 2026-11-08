import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { CHAR_GLYPH_STROKES } from "./testFixtures.js";
import { computeInkBoundingBox, renderGlyphPolylinesToRgba } from "../utils/ssim.js";
import { encodePngRgba } from "./pngUtils.js";
import { findShapeCandidates } from "./reviewShape.js";
import { POST } from "../../app/api/review/route.js";
import { requestReview } from "../review/client.mjs";

beforeEach((t) => {
  const previous = process.env;
  process.env = { ...previous, OCR_PROVIDER: "vision", OCR_API_KEY: "unit-test-key", GEMINI_API_KEY: "unit-test-key", GOOGLE_API_KEY: "", GEMINI_MODEL: "test-model" };
  t.after(() => { process.env = previous; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
});

// Synthetic glyphs, not real handwriting or live provider results.
function fixture(missing = false, text = "木") {
  const rgba = renderGlyphPolylinesToRgba(missing ? CHAR_GLYPH_STROKES.木.slice(1) : CHAR_GLYPH_STROKES.木, 96, 96, 1.6);
  const box = computeInkBoundingBox(rgba);
  const bounds = { x: box.minX, y: box.minY, width: box.maxX - box.minX + 1, height: box.maxY - box.minY + 1 };
  return { image: encodePngRgba(96, 96, Buffer.from(rgba.data)),
    spatial: { width: 96, height: 96, regions: [{ id: "0:0", row: 0, column: 0, ambiguous: false, bounds }] },
    characters: [{ text, start: 0, end: 1, bounds }], segments: [{ text, confidence: 0.95, bounds }] };
}
function check(value, candidates = [], targets = []) {
  return findShapeCandidates(value.image, value.spatial, value.characters, value.segments, candidates, targets);
}
function providers(t, value, confidence = 0.95) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).includes("vision.googleapis.com")) {
      calls.push("ocr");
      const { x, y, width, height } = value.characters[0].bounds;
      return Response.json({ responses: [{ fullTextAnnotation: { text: "木", pages: [{ blocks: [{ paragraphs: [{ words: [{ symbols: [{
        text: "木", confidence, boundingBox: { vertices: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] },
      }] }] }] }] }] } }] });
    }
    calls.push("grammar");
    const request = JSON.parse(init.body);
    assert.deepEqual(JSON.parse(request.contents[0].parts[0].text), { text: "木", level: "beginner" });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ correctedText: "木", issues: [] }) }] }, finishReason: "STOP" }] });
  });
  return calls;
}
const send = async (_, init) => POST(new Request("http://localhost/api/review", init));
const upload = (value) => requestReview({ image: new Blob([value.image], { type: "image/png" }), spatial: value.spatial }, 4, undefined, send);

test("similar synthetic shape proceeds through actual review endpoint to grammar", async (t) => {
  const value = fixture();
  assert.deepEqual(check(value), []);
  const calls = providers(t, value);
  const result = await upload(value);
  assert.equal(result.recognizedText, "木");
  assert.equal(result.correctedText, "木");
  assert.equal(result.requiresVerification, undefined);
  assert.deepEqual(calls, ["ocr", "grammar"]);
});

test("synthetic template differences do not block recognised handwriting or grammar", async (t) => {
  const value = fixture(true);
  const calls = providers(t, value);
  const result = await upload(value);
  assert.equal(result.requiresVerification, undefined);
  assert.equal(result.ocrSegments[0].confidence, 0.95);
  assert.equal(result.correctedText, "木");
  assert.deepEqual(calls, ["ocr", "grammar"]);
});

test("unsupported references, missing geometry, unknown confidence and ambiguous regions skip comparison", () => {
  const original = fixture(true);
  for (const change of [
    (value) => { value.spatial = undefined; },
    (value) => { value.characters[0].bounds = null; },
    (value) => { value.characters[0].text = value.segments[0].text = "鬱"; },
    (value) => { value.segments[0].confidence = null; },
    (value) => { value.segments[0].confidence = 0.75; },
    (value) => { value.spatial.regions[0].ambiguous = true; },
    (value) => { value.spatial.regions.push({ ...value.spatial.regions[0], id: "other" }); },
    (value) => { value.characters.push({ ...value.characters[0], start: 1, end: 2 }); value.segments.push({ ...value.segments[0] }); },
    (value) => { value.characters[0].bounds = { x: 0, y: 0, width: 96, height: 96 }; },
  ]) {
    const value = structuredClone(original);
    value.image = Buffer.from(value.image);
    change(value);
    assert.deepEqual(check(value), []);
  }
});

test("existing candidate choices and low-confidence English-intent targets are not replaced", () => {
  const value = fixture(true);
  assert.deepEqual(check(value, [{ position: 0 }]), []);
  assert.deepEqual(check(value, [], [{ start: 0, end: 1 }]), []);
});

test("moderate scores pass and genuinely low or unknown scores retain verification", async (t) => {
  for (const confidence of [0.75, 0.74, 0.60, 0.40, null]) {
    const value = fixture(true);
    const calls = providers(t, value, confidence);
    const result = await upload(value);
    if (confidence !== null && confidence >= 0.75) {
      assert.deepEqual(calls, ["ocr", "grammar"]);
      assert.equal(result.requiresVerification, undefined);
      continue;
    }
    assert.deepEqual(calls, ["ocr"]);
    assert.equal(result.requiresVerification, true);
    assert.ok(result.characterCandidates.every((candidate) => candidate.visuallyUncertain !== true));
    if (confidence === 0.40) assert.equal(result.intentTargets[0].original, "木");
    else assert.ok(result.characterCandidates.length > 0);
  }
});

test("unsupported or corrupt PNGs skip shape comparison rather than inventing pixel data", () => {
  for (const mutate of [
    (bytes) => { bytes[25] = 3; },
    (bytes) => { bytes[28] = 1; },
    (bytes) => { bytes[24] = 16; },
    (bytes) => { bytes.fill(0, 33); },
  ]) {
    const value = fixture(true);
    mutate(value.image);
    assert.deepEqual(check(value), []);
  }
});
