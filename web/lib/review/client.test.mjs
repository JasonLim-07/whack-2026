import test from "node:test";
import assert from "node:assert/strict";
import { createReviewRunner, getConfirmedText, requestConfirmedReview, requestReview, validateReview } from "./client.mjs";

const review = (revision = 3) => ({
  recognizedText: "我有两个书。", correctedText: "我有两本书。", ocrConfidence: null, ocrSegments: [], revision,
  issues: [{ id: "one", type: "word_choice", original: "个", replacement: "本", explanation: "Use 本 for books." }],
});
const image = new Blob(["test-png"], { type: "image/png" });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function callbacks(extra = {}) {
  const events = [];
  return { events, options: {
    exportImage: async () => image, revision: 3, isCurrent: (revision) => revision === 3,
    onStart: () => events.push("start"), onSuccess: (result) => events.push(result),
    onError: (message) => events.push(message), onFinish: () => events.push("finish"), ...extra,
  } };
}

test("request posts the agreed multipart fields and passes the response through unchanged", async () => {
  const signal = new AbortController().signal;
  const result = await requestReview(image, 3, signal, async (url, options) => {
    assert.equal(url, "/api/review");
    assert.equal(options.method, "POST");
    assert.equal(options.signal, signal);
    assert.equal(options.headers, undefined);
    assert.equal(options.body.get("image").type, "image/png");
    assert.equal(options.body.get("image").name, "inkling-handwriting.png");
    assert.equal(options.body.get("image").size, image.size);
    assert.equal(options.body.get("level"), "beginner");
    assert.equal(options.body.get("revision"), "3");
    return Response.json(review());
  });
  assert.deepEqual(result, review());
});

test("valid responses include no issues, null confidence, deletions, and actual confidence scores", () => {
  for (const value of [review(), { ...review(), issues: [], ocrConfidence: 0.9 },
    { ...review(), issues: [{ ...review().issues[0], replacement: "" }], ocrSegments: [{ text: "我", confidence: null }] }]) {
    assert.equal(validateReview(value, 3), value);
  }
});

test("malformed success, mismatched revisions, bad confidence and duplicate issue IDs are rejected", () => {
  for (const value of [null, {}, { ...review(), revision: 2 }, { ...review(), ocrConfidence: 4 },
    { ...review(), issues: null }, { ...review(), recognizedText: " " }, { ...review(), ocrSegments: [{}] },
    { ...review(), issues: [{ ...review().issues[0], type: "style" }] },
    { ...review(), issues: [review().issues[0], review().issues[0]] }]) {
    assert.throws(() => validateReview(value, 3), /unexpected response/);
  }
});

test("HTTP, invalid JSON and network errors have useful retry messages", async () => {
  for (const status of [400, 413, 422, 429, 500, 502, 503]) {
    await assert.rejects(requestReview(image, 3, undefined,
      async () => Response.json({ error: { code: "TEST", message: "Please try again later." } }, { status })), /Please try again later/);
  }
  await assert.rejects(requestReview(image, 3, undefined, async () => new Response("broken")), /unexpected response/);
  await assert.rejects(requestReview(image, 3, undefined, async () => { throw new TypeError("fetch failed"); }), /Check your connection/);
});

const verification = () => ({
  status: "LOW_CONFIDENCE", recognizedText: "我有三书。", ocrConfidence: null, ocrSegments: [],
  requiresVerification: true, revision: 3,
  characterCandidates: [{ position: 3, originalAttempt: "书", confidence: null,
    options: [{ char: "本", reason: "Context suggestion" }, { char: "书", reason: "Original" }, { char: "韦", reason: "Suggestion" }] }],
});

test("verification and missing confidence never require premature grammar output", () => {
  const value = verification();
  assert.equal(validateReview(value, 3), value);
  delete value.ocrConfidence;
  delete value.characterCandidates[0].confidence;
  assert.equal(validateReview(value, 3), value);
  assert.throws(() => getConfirmedText(value, {}), /Choose an option/);
  assert.equal(getConfirmedText(value, { 3: "书" }), "我有三书。");
  assert.equal(getConfirmedText(value, { 3: "本" }), "我有三本。");
});

test("candidate validation rejects unsafe positions, duplicate positions and malformed alternatives", () => {
  for (const position of [-1, 99, 1.5, "3"]) {
    const value = verification();
    value.characterCandidates[0].position = position;
    assert.throws(() => validateReview(value, 3), /unexpected response/);
  }
  for (const change of [
    (value) => value.characterCandidates.push(value.characterCandidates[0]),
    (value) => { value.characterCandidates[0].originalAttempt = "木"; },
    (value) => { value.characterCandidates[0].options[0].char = "本书"; },
    (value) => { value.characterCandidates[0].options[0].char = "书"; },
    (value) => { value.characterCandidates[0].options = [{ char: "本", reason: "Suggestion" }]; },
    (value) => { value.requiresVerification = false; },
    (value) => { value.revision = 2; },
  ]) {
    const value = verification();
    change(value);
    assert.throws(() => validateReview(value, 3), /unexpected response/);
  }
  assert.throws(() => getConfirmedText(verification(), { 3: "木" }), /Choose an option/);
});

test("confirmation uses Unicode code-point positions and preserves every other character", () => {
  const value = verification();
  value.recognizedText = "𠮷 我有三书。\n";
  value.characterCandidates[0].position = 5;
  assert.equal(getConfirmedText(value, { 5: "本", 0: "田" }), "𠮷 我有三本。\n");
  assert.equal(getConfirmedText(value, { 5: "书" }), value.recognizedText);
});

test("confirmed request sends JSON with revision and learner level, not an image", async () => {
  const signal = new AbortController().signal;
  const result = await requestConfirmedReview("我有三书。", 3, signal, async (url, options) => {
    assert.equal(url, "/api/review");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), { text: "我有三书。", level: "beginner", revision: 3 });
    assert.equal(options.signal, signal);
    return Response.json(review());
  });
  assert.deepEqual(result, review());
  await assert.rejects(requestConfirmedReview(" ", 3), /must not be empty/);
  await assert.rejects(requestConfirmedReview("我", 3, undefined, async () => Response.json(review(2))), /unexpected response/);
});

test("confirmation runner shares the duplicate guard and discards results after drawing edits", async () => {
  let current = true;
  let exports = 0;
  const response = deferred();
  const runner = createReviewRunner(undefined, () => response.promise);
  const { options, events } = callbacks({ text: "我有三书。", exportImage: async () => { exports++; return image; }, isCurrent: () => current });
  const task = runner.run(options);
  assert.equal(await runner.run(options), false);
  current = false; // covers drawing, undo or clear changing the revision
  response.resolve(review());
  await task;
  assert.equal(exports, 0);
  assert.deepEqual(events, ["start", "finish"]);
});

test("cancelled confirmation cannot overwrite a subsequent review even if abort is ignored", async () => {
  const late = deferred();
  let signal;
  const runner = createReviewRunner(async () => review(), (_, __, suppliedSignal) => { signal = suppliedSignal; return late.promise; });
  const old = callbacks({ text: "我有三书。" });
  const task = runner.run(old.options);
  runner.cancel();
  assert.equal(signal.aborted, true);
  const next = callbacks();
  await runner.run(next.options);
  late.resolve(review());
  await task;
  assert.deepEqual(old.events, ["start"]);
  assert.deepEqual(next.events, ["start", review(), "finish"]);
});

test("failed confirmation can retry the same selected text without OCR or PNG export", async () => {
  let attempts = 0;
  const runner = createReviewRunner(async () => { throw new Error("OCR must not run"); }, async (text) => {
    assert.equal(text, "我有三书。");
    if (++attempts === 1) throw new Error("Grammar temporarily unavailable");
    return review();
  });
  const { options, events } = callbacks({ text: "我有三书。", exportImage: async () => { throw new Error("Must not export"); } });
  await runner.run(options);
  await runner.run(options);
  assert.deepEqual(events, ["start", "Grammar temporarily unavailable", "finish", "start", review(), "finish"]);
});

test("frontend verification to JSON confirmation runs grammar only after explicit selection", async () => {
  const { handleReview } = await import("../ai/review.js");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVXcAAAAASUVORK5CYII=", "base64");
  const stages = [];
  const send = async (_, options) => handleReview(new Request("http://localhost/api/review", options), {
    recogniseHandwriting: async () => {
      stages.push("ocr");
      return { text: "我有三书。", confidence: null, segments: [], status: "LOW_CONFIDENCE",
        requiresVerification: true, characterCandidates: verification().characterCandidates };
    },
    analyseGrammar: async (text) => {
      stages.push("grammar");
      assert.equal(text, "我有三书。");
      return { correctedText: "我有三本书。", issues: [{ id: "one", type: "grammar", original: "三书", replacement: "三本书", explanation: "Use 本 for books." }] };
    },
  });
  const pending = await requestReview(new Blob([png], { type: "image/png" }), 3, undefined, send);
  assert.equal(pending.requiresVerification, true);
  assert.deepEqual(stages, ["ocr"]);
  assert.throws(() => getConfirmedText(pending, {}), /Choose an option/);
  const result = await requestConfirmedReview(getConfirmedText(pending, { 3: "书" }), 3, undefined, send);
  assert.deepEqual(stages, ["ocr", "grammar"]);
  assert.equal(result.correctedText, "我有三本书。");
});

test("runner guards against duplicates during export and network; unlocks after success", async () => {
  const exported = deferred();
  const response = deferred();
  const runner = createReviewRunner(() => response.promise);
  const { options, events } = callbacks({ exportImage: () => exported.promise });
  const first = runner.run(options);
  assert.deepEqual(events, ["start"]);
  assert.equal(await runner.run(options), false);
  exported.resolve(image);
  await Promise.resolve();
  assert.equal(await runner.run(options), false);
  response.resolve(review());
  await first;
  assert.deepEqual(events, ["start", review(), "finish"]);
  await runner.run(callbacks().options);
});

test("export and request failures unlock and permit retry", async () => {
  for (const exportFailure of [true, false]) {
    const runner = createReviewRunner(async () => { throw new Error("Request failed"); });
    const { options, events } = callbacks(exportFailure ? { exportImage: async () => { throw new Error("Export failed"); } } : {});
    await runner.run(options);
    assert.deepEqual(events, ["start", exportFailure ? "Export failed" : "Request failed", "finish"]);
    await runner.run(options);
    assert.equal(events.filter((value) => value === "finish").length, 2);
  }
});

test("changed handwriting discards late results; cancellation aborts and detaches callbacks", async () => {
  let current = true;
  const response = deferred();
  let signal;
  const runner = createReviewRunner((_, __, suppliedSignal) => { signal = suppliedSignal; return response.promise; });
  const { options, events } = callbacks({ isCurrent: () => current });
  const task = runner.run(options);
  await Promise.resolve();
  current = false;
  response.resolve(review());
  await task;
  assert.deepEqual(events, ["start", "finish"]);
  const late = deferred();
  const cancelledRunner = createReviewRunner((_, __, suppliedSignal) => { signal = suppliedSignal; return late.promise; });
  const cancelled = callbacks();
  const cancelledTask = cancelledRunner.run(cancelled.options);
  await Promise.resolve();
  cancelledRunner.cancel();
  assert.equal(signal.aborted, true);
  late.resolve(review());
  await cancelledTask;
  assert.deepEqual(cancelled.events, ["start"]);
});

test("frontend multipart request passes through the real backend handler and grammar validation", async () => {
  const { handleReview } = await import("../ai/review.js");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVXcAAAAASUVORK5CYII=", "base64");
  const stages = [];
  const result = await requestReview(new Blob([png], { type: "image/png" }), 3, undefined,
    async (_, init) => handleReview(new Request("http://localhost/api/review", init), {
      recogniseHandwriting: async (buffer, mimeType) => {
        assert.deepEqual(buffer, png);
        assert.equal(mimeType, "image/png");
        stages.push("ocr");
        return { text: review().recognizedText, confidence: null, segments: [] };
      },
      analyseGrammar: async (text, options) => {
        assert.equal(text, review().recognizedText);
        assert.deepEqual(options, { level: "beginner" });
        stages.push("grammar");
        return { correctedText: review().correctedText, issues: review().issues };
      },
    }));
  assert.deepEqual(stages, ["ocr", "grammar"]);
  assert.deepEqual(result, review());
});
