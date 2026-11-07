import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test, { beforeEach } from "node:test";
import { POST, runtime } from "../../app/api/review/route.js";
import { handleReview, reviewHandwriting } from "./review.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVXcAAAAASUVORK5CYII=", "base64");
const issue = {
  id: "issue-1", type: "grammar", original: "个", replacement: "本",
  explanation: "Use 本 as the measure word for books.",
};
const correction = { correctedText: "我有两本书。", issues: [issue] };

beforeEach((t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("External requests are forbidden in review tests.");
  });
});

function form() {
  const data = new FormData();
  data.set("image", new File([png], "writing.png", { type: "image/png" }));
  return data;
}

function request(data = form()) {
  return new Request("http://localhost/api/review", { method: "POST", body: data });
}

function dependencies(overrides = {}) {
  return {
    recogniseHandwriting: async () => ({ text: "我有两个书。", confidence: null, segments: [] }),
    analyseGrammar: async () => structuredClone(correction),
    ...overrides,
  };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.deepEqual(Object.keys(body.error), ["code", "message"]);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, "string");
  assert.doesNotMatch(JSON.stringify(body), /private-provider-details|secret-test-key|stack/);
}

test("multipart PNG review combines OCR and grammar with the exact contract", async (t) => {
  const data = form();
  data.set("level", "intermediate");
  data.set("revision", "3");
  const calls = [];
  const response = await handleReview(request(data), dependencies({
    recogniseHandwriting: async (buffer, mimeType) => {
      assert.ok(Buffer.isBuffer(buffer));
      assert.deepEqual(buffer, png);
      assert.equal(mimeType, "image/png");
      calls.push("ocr");
      return { text: "我有两个书。", confidence: null, segments: [] };
    },
    analyseGrammar: async (text, options) => {
      assert.equal(text, "我有两个书。");
      assert.deepEqual(options, { level: "intermediate" });
      calls.push("grammar");
      return correction;
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["ocr", "grammar"]);
  const result = await response.json();
  assert.deepEqual(result, {
    recognizedText: "我有两个书。", ocrConfidence: null, ocrSegments: [],
    correctedText: "我有两本书。", issues: [issue], revision: 3,
  });
  t.diagnostic(`Mock integration response: ${JSON.stringify(result)}`);
});

test("missing image is rejected before any provider runs", async () => {
  const data = form();
  data.delete("image");
  let called = false;
  await expectError(await handleReview(request(data), dependencies({
    recogniseHandwriting: async () => { called = true; },
  })), 400, "INVALID_IMAGE");
  assert.equal(called, false);
});

test("empty images and string image fields are rejected", async () => {
  for (const image of [new File([], "empty.png", { type: "image/png" }), "image.png"]) {
    const data = form();
    data.set("image", image);
    await expectError(await POST(request(data)), 400, "INVALID_IMAGE");
  }
});

test("both declared PNG MIME type and the full signature are required", async () => {
  for (const [bytes, type] of [
    [png, "image/jpeg"], [png, "application/octet-stream"],
    [Buffer.from("not a png"), "image/png"], [png.subarray(0, 7), "image/png"],
  ]) {
    const data = form();
    data.set("image", new File([bytes], "writing.png", { type }));
    await expectError(await POST(request(data)), 400, "INVALID_IMAGE");
  }
});

test("images above 5 MiB are rejected; exactly 5 MiB passes size validation", async () => {
  for (const size of [MAX_IMAGE_BYTES, MAX_IMAGE_BYTES + 1]) {
    const bytes = Buffer.alloc(size);
    png.copy(bytes);
    const data = form();
    data.set("image", new File([bytes], "writing.png", { type: "image/png" }));
    await expectError(await POST(request(data)), size === MAX_IMAGE_BYTES ? 503 : 413,
      size === MAX_IMAGE_BYTES ? "OCR_UNAVAILABLE" : "IMAGE_TOO_LARGE");
  }
});

test("oversized multipart bodies are bounded even without Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 64 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  const upload = new Request("http://localhost/api/review", {
    method: "POST", body, duplex: "half",
    headers: { "content-type": "multipart/form-data; boundary=test" },
  });
  await expectError(await POST(upload), 413, "IMAGE_TOO_LARGE");
  assert.equal(cancelled, true);
});

test("oversized declared Content-Length is rejected before consuming the body", async () => {
  const upload = request();
  upload.headers.set("content-length", String(MAX_IMAGE_BYTES + 64 * 1024 + 1));
  await expectError(await POST(upload), 413, "IMAGE_TOO_LARGE");
  assert.equal(upload.bodyUsed, false);
});

test("malformed multipart bodies and wrong content types return safe 400s", async () => {
  for (const headers of [
    { "content-type": "application/json" },
    { "content-type": "multipart/form-data; boundary=missing" },
    { "content-type": "multipart/form-data" },
  ]) {
    const upload = new Request("http://localhost/api/review", { method: "POST", headers, body: "broken" });
    await expectError(await POST(upload), 400, "INVALID_REQUEST");
  }
});

test("revision must be an optional non-negative safe integer", async () => {
  for (const revision of ["", " ", "-1", "1.5", "1e2", "NaN", "9007199254740992", new File(["1"], "revision")]) {
    const data = form();
    data.set("revision", revision);
    await expectError(await POST(request(data)), 400, "INVALID_REVISION");
  }
  const data = form();
  data.set("revision", "0");
  const response = await handleReview(request(data), dependencies());
  assert.equal((await response.json()).revision, 0);
});

test("invalid optional learner levels and duplicate fields are rejected", async () => {
  for (const level of ["", "  ", new File(["beginner"], "level")]) {
    const data = form();
    data.set("level", level);
    await expectError(await POST(request(data)), 400, "INVALID_LEVEL");
  }
  for (const field of ["image", "level", "revision"]) {
    const data = form();
    if (!data.has(field)) data.set(field, field === "revision" ? "1" : "beginner");
    data.append(field, data.get(field));
    await expectError(await POST(request(data)), 400, "INVALID_REQUEST");
  }
});

test("OCR empty or invalid transcription returns 400 without running grammar", async () => {
  for (const text of ["", " \n", undefined, null, 123]) {
    let called = false;
    await expectError(await handleReview(request(), dependencies({
      recogniseHandwriting: async () => ({ text, confidence: null, segments: [] }),
      analyseGrammar: async () => { called = true; },
    })), 400, "UNREADABLE_TEXT");
    assert.equal(called, false);
  }
});

test("OCR provider failures return sanitized 502 responses", async () => {
  await expectError(await handleReview(request(), dependencies({
    recogniseHandwriting: async () => { throw new Error("private-provider-details secret-test-key"); },
  })), 502, "OCR_FAILED");
});

test("grammar provider failures return sanitized 502 responses", async () => {
  await expectError(await handleReview(request(), dependencies({
    analyseGrammar: async () => { throw new Error("private-provider-details secret-test-key"); },
  })), 502, "GRAMMAR_FAILED");
});

test("distinguishable OCR and grammar rate limits return 429", async () => {
  for (const overrides of [
    { recogniseHandwriting: async () => { throw Object.assign(new Error("secret-test-key"), { status: 429 }); } },
    { analyseGrammar: async () => { throw Object.assign(new Error("secret-test-key"), { statusCode: 429 }); } },
    { analyseGrammar: async () => { throw new Error("Gemini rate limit or quota exceeded (HTTP 429). Try again later or check your quota."); } },
  ]) {
    await expectError(await handleReview(request(), dependencies(overrides)), 429, "RATE_LIMITED");
  }
});

test("invalid OCR confidence and segment schemas return 502", async () => {
  for (const metadata of [
    { confidence: undefined, segments: [] }, { confidence: NaN, segments: [] },
    { confidence: -0.1, segments: [] }, { confidence: 1.1, segments: [] },
    { confidence: "0.8", segments: [] }, { confidence: null, segments: null },
    { confidence: null, segments: [null] }, { confidence: null, segments: [{ text: "我", confidence: 2 }] },
    { confidence: null, segments: [{ text: 1, confidence: null }] },
  ]) {
    const response = await handleReview(request(), dependencies({
      recogniseHandwriting: async () => ({ text: "我是学生。", ...metadata }),
    }));
    await expectError(response, 502, "INVALID_OCR_RESPONSE");
  }
});

test("original OCR text and real segment confidence are preserved without deriving an overall score", async () => {
  const text = "  我是学生。\n";
  const segments = [{ text: "我是", confidence: 0.8 }, { text: "学生。", confidence: null }];
  const response = await handleReview(request(), dependencies({
    recogniseHandwriting: async () => ({ text, confidence: null, segments }),
    analyseGrammar: async (received, options) => {
      assert.equal(received, text);
      assert.deepEqual(options, { level: "beginner" });
      return { correctedText: "我是学生。", issues: [] };
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    recognizedText: text, ocrConfidence: null, ocrSegments: segments,
    correctedText: text, issues: [], revision: null,
  });
});

test("provider-reported overall confidence is preserved", async () => {
  const response = await handleReview(request(), dependencies({
    recogniseHandwriting: async () => ({ text: "我有两个书。", confidence: 0.92, segments: [] }),
  }));
  assert.equal((await response.json()).ocrConfidence, 0.92);
});

test("malformed grammar output is rejected by the existing grammar validator", async () => {
  for (const result of [{ correctedText: "我是学生。" }, { ...correction, issues: [{ ...issue, type: "style" }] }]) {
    await expectError(await handleReview(request(), dependencies({ analyseGrammar: async () => result })), 502, "GRAMMAR_FAILED");
  }
});

test("orchestration can be called independently with injected dependencies", async () => {
  const result = await reviewHandwriting({ imageBuffer: png, revision: 7 }, dependencies());
  assert.equal(result.revision, 7);
  assert.deepEqual(result.issues, [issue]);
});

test("unexpected internal failures return a safe 500", async () => {
  const brokenRequest = { get headers() { throw new Error("private-provider-details secret-test-key"); } };
  await expectError(await POST(brokenRequest), 500, "INTERNAL_ERROR");
});

test("actual Node.js route returns 503 until real OCR is wired in", async () => {
  assert.equal(runtime, "nodejs");
  const response = await POST(request());
  await expectError(response, 503, "OCR_UNAVAILABLE");
});
