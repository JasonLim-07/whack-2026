import test from "node:test";
import assert from "node:assert/strict";
import { createReviewRunner, getConfirmedText, requestConfirmedReview, requestReview, validateReview, requestIntentSuggestions, validateIntentResult } from "./client.mjs";

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
      return { correctedText: "我有三本书。", issues: [{ id: "one", type: "grammar", start: 2, end: 4, original: "三书", replacement: "三本书", explanation: "Use 本 for books." }] };
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

test("review upload forwards optional spatial metadata from the same export snapshot", async () => {
  const spatial = { width: 120, height: 100, regions: [{ id: "0:0", row: 0, column: 0, ambiguous: false,
    bounds: { x: 24, y: 24, width: 40, height: 50 } }] };
  await requestReview({ image, spatial, strokes: [{ id: "local-only", points: [{ x: 10, y: 20 }] }] }, 3, undefined, async (_, options) => {
    assert.equal(options.body.get("image").size, image.size);
    assert.deepEqual(JSON.parse(options.body.get("spatial")), spatial);
    assert.equal(options.body.get("revision"), "3");
    assert.equal(options.body.has("strokes"), false);
    assert.deepEqual([...options.body.keys()].sort(), ["image", "level", "revision", "spatial"]);
    return Response.json(review());
  });
});

test("whole-text clarification allows missing-character entry without guessing its position", () => {
  const value = { ...verification(), recognizedText: "我", characterCandidates: [], requiresTextConfirmation: true,
    clarificationMessage: "Check unmatched marks.", unresolvedRegions: [{ id: "0:1", row: 0, column: 1 }] };
  assert.equal(validateReview(value, 3), value);
  assert.equal(getConfirmedText(value, {}, "我有三书。"), "我有三书。");
  assert.throws(() => getConfirmedText(value, {}, ""), /complete Chinese text/);
  assert.throws(() => getConfirmedText(value, {}, "Hello"), /Chinese characters/);
  assert.equal(getConfirmedText(value, {}, "我用iPhone。"), "我用iPhone。");
  assert.throws(() => validateReview({ ...value, unresolvedRegions: [{}] }, 3), /unexpected response/);
});

test("Latin-only confirmation is rejected before any frontend request", async () => {
  let calls = 0;
  await assert.rejects(requestConfirmedReview("Hello，！", 3, undefined, async () => { calls++; }), /Chinese characters/);
  assert.equal(calls, 0);
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

const intentReview = () => ({ ...verification(), recognizedText: "我有三□。", characterCandidates: [],
  intentTargets: [{ id: "intent:3", start: 3, end: 4, original: "□" }] });
const suggestions = { "intent:3": [{ text: "书", explanation: "Books." }, { text: "树", explanation: "Trees." }] };

test("English-intent replacement requires explicit selection and preserves surrounding mistakes", () => {
  assert.throws(() => getConfirmedText(intentReview(), {}, undefined, suggestions), /Choose a Chinese suggestion/);
  assert.throws(() => getConfirmedText(intentReview(), { "intent:3": "本书" }, undefined, suggestions), /Choose a Chinese suggestion/);
  assert.equal(getConfirmedText(intentReview(), { "intent:3": "书" }, undefined, suggestions), "我有三书。");
});

test("missing insertions and character choices compose without shifting original code-point positions", () => {
  const pending = { ...verification(), recognizedText: "𠮷书。", characterCandidates: [{ position: 1, originalAttempt: "书", confidence: 0.75,
    options: [{ char: "书", reason: "Original" }, { char: "韦", reason: "Alternative" }] }],
    intentTargets: [{ id: "missing", start: 1, end: 1, original: "" }] };
  assert.equal(getConfirmedText(pending, { missing: "有三", 1: "书" }, undefined, { missing: [{ text: "有三" }] }), "𠮷有三书。");
});

test("malformed or overlapping intent targets fail safely", () => {
  for (const targets of [{}, null, [null], [{ id: "x", start: 3, end: 4, original: "错" }],
    [{ id: "x", start: 3, end: 4, original: "□" }, { id: "y", start: 3, end: 4, original: "□" }]]) {
    assert.throws(() => validateReview({ ...intentReview(), intentTargets: targets }, 3), /unexpected response/);
  }
});

test("explicit English-intent request uses its own JSON endpoint and validates revision and Chinese options", async () => {
  const result = { suggestions: suggestions["intent:3"], revision: 3 };
  assert.deepEqual(await requestIntentSuggestions("books", "我有三[unclear]。", 3, undefined, async (url, init) => {
    assert.equal(url, "/api/intent");
    assert.deepEqual(JSON.parse(init.body), { description: "books", context: "我有三[unclear]。", revision: 3 });
    return Response.json(result);
  }), result);
  for (const value of [{ ...result, revision: 4 }, { ...result, suggestions: [] },
    { ...result, suggestions: [{ text: "books", explanation: "Wrong script" }] }]) {
    assert.throws(() => validateIntentResult(value, 3), /unexpected response/);
  }
});

test("intent request shares duplicate guards and ignores stale suggestions after drawing changes", async () => {
  const waiting = deferred();
  let count = 0;
  const runner = createReviewRunner(() => { throw new Error("Must not export or OCR"); },
    () => { throw new Error("Must not run grammar"); }, async () => { count++; return waiting.promise; });
  const state = callbacks({ intent: "books", context: "我有三□。", exportImage: () => { throw new Error("No PNG export"); } });
  const pending = runner.run(state.options);
  assert.equal(await runner.run(state.options), false);
  runner.cancel();
  waiting.resolve({ suggestions: suggestions["intent:3"], revision: 3 });
  await pending;
  assert.equal(count, 1);
  assert.deepEqual(state.events, ["start"]);
});

test("discarding a stray mark is explicit and allowed only for an omitted region", () => {
  const missing = { ...intentReview(), recognizedText: "我有三书。", intentTargets: [{ id: "mark", start: 5, end: 5, original: "" }] };
  assert.throws(() => getConfirmedText(missing, {}), /Choose/);
  assert.equal(getConfirmedText(missing, { mark: "" }), "我有三书。");
  assert.throws(() => getConfirmedText(intentReview(), { "intent:3": "" }), /Choose/);
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

test("combined snapshot retains spatial coverage through review and world origin for grammar highlights", async () => {
  const { handleReview } = await import("../ai/review.js");
  const { handwritingHighlights } = await import("./locations.mjs");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVXcAAAAASUVORK5CYII=", "base64");
  const box = { x: 0, y: 0, width: 1, height: 1 };
  const snapshot = { image: new Blob([png], { type: "image/png" }), revision: 3,
    bounds: { left: -90, top: -20, width: 1, height: 1 },
    spatial: { width: 1, height: 1, regions: [{ id: "0:0", row: 0, column: 0, ambiguous: false, bounds: box }] } };
  const issue = { id: "one", start: 0, end: 1, type: "character", original: "书", replacement: "树", explanation: "Use the character for tree." };
  let result;
  const runner = createReviewRunner((payload, revision, signal) => requestReview(payload, revision, signal, async (_, init) => {
    assert.deepEqual(JSON.parse(init.body.get("spatial")), snapshot.spatial);
    return handleReview(new Request("http://localhost/api/review", init), {
      recogniseHandwriting: async () => ({ text: "书", confidence: null, status: "SUCCESS", requiresVerification: false,
        segments: [{ text: "书", confidence: 0.95, bounds: box }], characters: [{ text: "书", start: 0, end: 1, bounds: box }] }),
      analyseGrammar: async () => ({ correctedText: "树", issues: [issue] }),
    });
  }));
  await runner.run(callbacks({ exportSnapshot: async () => snapshot, onSuccess: (value, captured) => { result = { value, captured }; } }).options);
  assert.equal(result.value.correctedText, "树");
  assert.deepEqual(handwritingHighlights(result.value, result.captured.bounds), [{ issueId: "one", x: -90, y: -20, width: 1, height: 1 }]);
});

test("snapshot revision mismatch never reaches OCR and intent bypasses snapshot export", async () => {
  let submissions = 0;
  const runner = createReviewRunner(async () => { submissions++; }, undefined, async () => ({ revision: 3, suggestions: suggestions["intent:3"] }));
  const mismatch = callbacks({ exportSnapshot: async () => ({ image, revision: 2 }) });
  await runner.run(mismatch.options);
  assert.equal(submissions, 0);
  assert.deepEqual(mismatch.events, ["start", "finish"]);
  const intent = callbacks({ intent: "book", context: "我有三[unclear]。", exportSnapshot: () => { throw new Error("Must not export"); } });
  await runner.run(intent.options);
  assert.deepEqual(intent.events, ["start", { revision: 3, suggestions: suggestions["intent:3"] }, "finish"]);
});

test("confirmed grammar feedback retains OCR boxes and highlights the same ink", async () => {
  const { restoreConfirmedLocations } = await import("./client.mjs");
  const { handwritingHighlights } = await import("./locations.mjs");
  const { handleReview } = await import("../ai/review.js");
  const box = { x: 30, y: 10, width: 20, height: 25 };
  const source = { ...verification(), ocrCharacters: Array.from(verification().recognizedText,
    (text, start) => ({ text, start, end: start + 1, bounds: box })) };
  const selections = { 3: "书" };
  const text = getConfirmedText(source, selections);
  const issue = { id: "measure", start: 2, end: 4, original: "三书", replacement: "三本书", type: "grammar", explanation: "Use 本 for books." };
  let located;
  const runner = createReviewRunner(undefined, (value, revision, signal) => requestConfirmedReview(value, revision, signal,
    async (_, init) => handleReview(new Request("http://localhost/api/review", init), {
      analyseGrammar: async () => ({ correctedText: "我有三本书。", issues: [issue] }),
      recogniseHandwriting: () => { throw new Error("Confirmation must not repeat OCR"); },
    })));
  await runner.run(callbacks({ text, exportSnapshot: () => { throw new Error("Must keep the original snapshot"); },
    onSuccess(result) { located = restoreConfirmedLocations(result, source, selections); } }).options);
  assert.ok(located);
  assert.deepEqual(located.ocrCharacters, source.ocrCharacters);
  assert.equal(validateReview(located, 3), located);
  assert.deepEqual(handwritingHighlights(located, { left: -100, top: -20 }), [
    { issueId: "measure", x: -70, y: -10, width: 20, height: 25 },
    { issueId: "measure", x: -70, y: -10, width: 20, height: 25 },
  ]);
});

test("confirmation shifts known locations around insertions without assigning ink to new text", async () => {
  const { restoreConfirmedLocations } = await import("./client.mjs");
  const source = { ...verification(), characterCandidates: [], intentTargets: [{ id: "missing", start: 3, end: 3, original: "" }],
    ocrCharacters: Array.from(verification().recognizedText, (text, start) => ({ text, start, end: start + 1,
      bounds: { x: start * 20, y: 0, width: 15, height: 20 } })) };
  const selections = { missing: "本" };
  const suggestions = { missing: [{ text: "本" }] };
  const text = getConfirmedText(source, selections, undefined, suggestions);
  const result = restoreConfirmedLocations({ ...review(), recognizedText: text }, source, selections, undefined, suggestions);
  assert.equal(result.ocrCharacters[3].bounds, null);
  assert.deepEqual(result.ocrCharacters[4], { ...source.ocrCharacters[3], start: 4, end: 5 });
  assert.equal(result.ocrCharacters.map((entry) => entry.text).join(""), text);
  const stale = { ...review(), revision: 4 };
  assert.equal(restoreConfirmedLocations(stale, source, selections), stale);
});

test("whole-sentence edits retain boxes only when the transcription is unchanged", async () => {
  const { restoreConfirmedLocations } = await import("./client.mjs");
  const source = { ...verification(), requiresTextConfirmation: true, clarificationMessage: "Check the text.", unresolvedRegions: [],
    ocrCharacters: Array.from(verification().recognizedText, (text, start) => ({ text, start, end: start + 1, bounds: null })) };
  const unchanged = { ...review(), recognizedText: source.recognizedText };
  assert.deepEqual(restoreConfirmedLocations(unchanged, source, {}, source.recognizedText).ocrCharacters, source.ocrCharacters);
  const changed = { ...review(), recognizedText: "我有书。" };
  assert.equal(restoreConfirmedLocations(changed, source, {}, changed.recognizedText), changed);
});

test("single-character confirmation preserves its box using Unicode code-point offsets", async () => {
  const { restoreConfirmedLocations } = await import("./client.mjs");
  const source = { ...verification(), recognizedText: "𠀀书", characterCandidates: [{ position: 1, originalAttempt: "书", confidence: null,
    options: [{ char: "书", reason: "Original" }, { char: "本", reason: "Alternative" }] }],
    ocrCharacters: [{ text: "𠀀", start: 0, end: 1, bounds: null },
      { text: "书", start: 1, end: 2, bounds: { x: 30, y: 10, width: 20, height: 25 } }] };
  const confirmed = getConfirmedText(source, { 1: "本" });
  const result = restoreConfirmedLocations({ ...review(), recognizedText: confirmed, issues: [] }, source, { 1: "本" });
  assert.deepEqual(result.ocrCharacters[1], { ...source.ocrCharacters[1], text: "本" });
  assert.equal(validateReview(result, 3), result);
  assert.equal(source.ocrCharacters[1].text, "书");
});
