import test from "node:test";
import assert from "node:assert/strict";
import { createReviewRunner, requestReview, validateReview } from "./client.mjs";

const review = (revision = 3) => ({
  recognizedText: "我有两个书。", correctedText: "我有两本书。", ocrConfidence: null, ocrSegments: [], ocrCharacters: [], revision,
  issues: [{ id: "one", start: 3, end: 4, type: "word_choice", original: "个", replacement: "本", explanation: "Use 本 for books." }],
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
  for (const status of [400, 413, 429, 500, 502]) {
    await assert.rejects(requestReview(image, 3, undefined,
      async () => Response.json({ error: { code: "TEST", message: "Please try again later." } }, { status })), /Please try again later/);
  }
  await assert.rejects(requestReview(image, 3, undefined, async () => new Response("broken")), /unexpected response/);
  await assert.rejects(requestReview(image, 3, undefined, async () => { throw new TypeError("fetch failed"); }), /Check your connection/);
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

test("snapshot metadata is delivered with its result; edits during export cancel old callbacks", async () => {
  const firstExport = deferred();
  let submissions = 0;
  const runner = createReviewRunner(async () => { submissions++; return review(); });
  const first = callbacks({ exportSnapshot: () => firstExport.promise });
  const task = runner.run(first.options);
  runner.cancel(); // Called immediately at ink-edit start, before revision commits.
  const bounds = { left: -70, top: -90, width: 200, height: 100 };
  let captured;
  const next = callbacks({ exportSnapshot: async () => ({ image, revision: 3, bounds }), onSuccess: (value, snapshot) => { captured = { value, snapshot }; } });
  await runner.run(next.options);
  firstExport.resolve({ image, revision: 3, bounds });
  await task;
  assert.equal(submissions, 1);
  assert.equal(captured.snapshot.bounds, bounds);
  assert.deepEqual(captured.value, review());
  assert.deepEqual(first.events, ["start"]);
  assert.deepEqual(next.events, ["start", "finish"]);
});
