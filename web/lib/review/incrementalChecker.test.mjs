import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createIncrementalChecker, CHARACTER_DEBOUNCE_MS } from "./incrementalChecker.mjs";
import { incrementalRegions, exportRecognitionRegion, recognitionContext } from "../handwriting/incrementalRegions.mjs";
import { exportBounds } from "../handwriting/export.mjs";
import { writingRegions } from "../handwriting/regions.mjs";
import { sentenceRanges, scopedContextResult } from "./transcription.mjs";
import { appendStroke, undoEdit, redoEdit } from "../handwriting/strokes.mjs";
import { emptyMistakeHistory, mistakeReducer } from "./mistakes.mjs";
import { recogniseFullStop } from "../handwriting/punctuation.mjs";

const stroke = (id, column, text = "我", row = 0, uncertain = false) => ({ id, label: text, uncertain, width: 3,
  points: [{ x: column * 96 + 10, y: row * 96 + 10, timestamp: 10 },
    { x: column * 96 + (/[。.!?！？]/u.test(text) ? 14 : 70), y: row * 96 + 70, timestamp: 20 }] });
const sample = (text, prefix = "a", row = 0) => Array.from(text, (text, column) => stroke(`${prefix}${column}`, column, text, row));
function recognition(snapshot) {
  const text = snapshot.strokes.map((entry) => entry.label).join("");
  const candidates = snapshot.strokes.flatMap((entry, position) => entry.uncertain ? [{ position, originalAttempt: entry.label, confidence: 0.75,
    options: [{ char: entry.label, reason: "Original" }, { char: "本", reason: "Alternative" }] }] : []);
  return { recognizedText: text, revision: snapshot.revision, status: candidates.length ? "LOW_CONFIDENCE" : "SUCCESS",
    requiresVerification: candidates.length > 0, characterCandidates: candidates, ocrConfidence: null,
    ocrSegments: snapshot.strokes.map((entry) => ({ text: entry.label, confidence: entry.uncertain ? 0.75 : 0.95 })),
    ocrCharacters: snapshot.strokes.map((entry, start) => ({ text: entry.label, start, end: start + 1,
      bounds: { x: entry.points[0].x - snapshot.bounds.left - 1, y: entry.points[0].y - snapshot.bounds.top - 1, width: 62, height: 62 } })) };
}
function harness(options = {}) {
  const timers = new Map(); let nextId = 0, history = emptyMistakeHistory();
  const calls = { recognise: [], grammar: [] };
  const checker = createIncrementalChecker({
    schedule: (fn, ms) => { assert.equal(ms, CHARACTER_DEBOUNCE_MS); timers.set(++nextId, fn); return nextId; },
    unschedule: (id) => timers.delete(id),
    exportRegion: async (group, revision) => ({ image: new Blob(["PNG"], { type: "image/png" }), strokes: group.strokes,
      bounds: exportBounds(group.strokes), spatial: writingRegions(group.strokes), revision }),
    recognise: async (snapshot, signal) => { calls.recognise.push(snapshot); return options.recognise ? options.recognise(snapshot, signal) : recognition(snapshot); },
    grammar: async (text, revision, signal, level) => { calls.grammar.push({ text, revision, level });
      return options.grammar ? options.grammar(text, revision, signal) : { recognizedText: text, correctedText: text, issues: [], ocrConfidence: null, ocrSegments: [], ocrCharacters: [], revision }; },
    onObservation: (review, snapshot, allStrokes) => { history = mistakeReducer(history, { type: "review", review, snapshot, allStrokes }); },
    onConfirmation: (review, selections, intentSuggestions, confirmedText) => { history = mistakeReducer(history, { type: "confirm", review, selections, intentSuggestions, confirmedText }); },
  });
  return { checker, calls, timers, history: () => history };
}
const settle = async () => { await nextTurn(); await nextTurn(); };

test("debounce resets and never analyses an active gesture", async () => {
  const h = harness(); h.checker.update({ revision: 1, strokes: sample("我") });
  assert.equal(h.timers.size, 1);
  h.checker.setEditing(true); assert.equal(h.timers.size, 0);
  await h.checker.recogniseNow(); assert.equal(h.calls.recognise.length, 0);
  h.checker.setEditing(false);
  h.checker.update({ revision: 2, strokes: sample("我有") });
  assert.equal(h.timers.size, 1);
  await [...h.timers.values()][0]();
  assert.equal(h.calls.recognise.length, 2); h.checker.dispose();
});

test("new or modified regions alone are exported and unchanged recognition is reused", async () => {
  const h = harness(), first = sample("我有");
  h.checker.update({ revision: 1, strokes: first }); await h.checker.recogniseNow();
  h.checker.update({ revision: 2, strokes: [...first, stroke("new", 2, "书")] }); await h.checker.recogniseNow();
  assert.equal(h.calls.recognise.length, 3);
  assert.deepEqual(h.calls.recognise[2].strokes.map((entry) => entry.id), ["new"]);
  assert.equal(h.checker.getState().transcription.text, "我有书");
  h.checker.update({ revision: 3, strokes: first }); await h.checker.recogniseNow();
  h.checker.update({ revision: 4, strokes: [...first, stroke("new", 2, "书")] }); await h.checker.recogniseNow();
  assert.equal(h.calls.recognise.length, 3); h.checker.dispose();
});

test("punctuation triggers GCSE grammar, unfinished text requires manual checking, and results are cached", async () => {
  const h = harness(), first = sample("我是学生");
  h.checker.update({ revision: 1, strokes: first }); await h.checker.recogniseNow(); await settle();
  assert.equal(h.calls.grammar.length, 0);
  await h.checker.checkGrammar(); assert.equal(h.calls.grammar[0].level, "gcse");
  h.checker.update({ revision: 2, strokes: [...first, stroke("stop", 4, "。")] }); await h.checker.recogniseNow(); await settle();
  assert.equal(h.calls.grammar.at(-1).text, "我是学生。");
  await h.checker.checkGrammar(); assert.equal(h.calls.grammar.length, 2); h.checker.dispose();
});

test("uncertain transcription blocks grammar until explicit confirmation, without another OCR request", async () => {
  const h = harness(), strokes = sample("我有三书。"); strokes[3].uncertain = true;
  h.checker.update({ revision: 1, strokes }); await h.checker.recogniseNow(); await settle();
  assert.equal(h.calls.grammar.length, 0);
  const region = h.checker.getState().regions[3];
  assert.throws(() => h.checker.confirm(region.id, region.fingerprint, {}, ""), /Choose/);
  h.checker.confirm(region.id, region.fingerprint, { 0: "书" }, ""); await settle();
  assert.equal(h.calls.grammar.length, 1); assert.equal(h.calls.grammar[0].text, "我有三书。");
  assert.equal(h.calls.recognise.length, 5); assert.equal(h.history().occurrences.length, 1); h.checker.dispose();
});

test("only changed sentences are rechecked and character checking stays independent from grammar failures", async () => {
  const h = harness({ grammar: async (text, revision) => {
    if (text.includes("爱")) throw new Error("Grammar provider unavailable");
    return { recognizedText: text, correctedText: text, issues: [], revision };
  } });
  const first = sample("我有书。"), second = sample("你是学生。", "b", 1);
  h.checker.update({ revision: 1, strokes: [...first, ...second] }); await h.checker.recogniseNow(); await settle();
  const initial = h.calls.grammar.length;
  const changed = [...first]; changed[1] = stroke("replacement", 1, "爱");
  h.checker.update({ revision: 2, strokes: [...changed, ...second] }); await h.checker.recogniseNow(); await settle();
  assert.equal(h.calls.grammar.length, initial + 1);
  assert.equal(h.checker.getState().sentences[0].status, "error");
  assert.equal(h.checker.getState().sentences[1].status, "ready");
  assert.ok(h.checker.getState().regions.every((region) => region.status === "ready")); h.checker.dispose();
});

test("late OCR and grammar responses cannot replace newer writing", async () => {
  let release;
  const h = harness({ recognise: (snapshot) => new Promise((resolve) => { release = () => resolve(recognition(snapshot)); }) });
  h.checker.update({ revision: 1, strokes: sample("我") }); const pending = h.checker.recogniseNow();
  await settle(); h.checker.update({ revision: 2, strokes: [] }); release(); await pending;
  assert.equal(h.checker.getState().transcription.text, ""); h.checker.dispose();
  let releaseGrammar;
  const g = harness({ grammar: (text, revision) => new Promise((resolve) => { releaseGrammar = () => resolve({ recognizedText: text, correctedText: text, issues: [], revision }); }) });
  g.checker.update({ revision: 1, strokes: sample("我是学生。") }); await g.checker.recogniseNow(); await settle();
  g.checker.update({ revision: 2, strokes: [] }); releaseGrammar(); await settle();
  assert.equal(g.checker.getState().sentences.length, 0); g.checker.dispose();
});

test("cross-square grouping requires text confirmation and erased regions never call OCR", async () => {
  const strokes = [stroke("cross", 0)]; strokes[0].points[1].x = 120;
  const h = harness(); h.checker.update({ revision: 1, strokes }); await h.checker.recogniseNow();
  assert.equal(h.checker.getState().regions[0].review.requiresTextConfirmation, true);
  assert.equal(incrementalRegions(strokes).length, 1);
  h.checker.update({ revision: 2, strokes: [] }); await h.checker.recogniseNow();
  assert.equal(h.calls.recognise.length, 1); h.checker.dispose();
});

test("punctuation context is limited to its neighbour and never overwrites that transcription", () => {
  const ink = sample("我。"); ink[1].points[1].y = 14;
  const groups = incrementalRegions(ink), target = recognitionContext(groups[1], groups);
  assert.equal(target.context.id, groups[0].id);
  const snapshot = { bounds: exportBounds(target.strokes), strokes: target.strokes, revision: 1 };
  const result = scopedContextResult(recognition(snapshot), snapshot, target);
  assert.equal(result.recognizedText, "。");
  assert.equal(result.ocrCharacters[0].start, 0);
  const noBoxes = scopedContextResult({ ...recognition(snapshot), ocrCharacters: [] }, snapshot, target);
  assert.equal(noBoxes.requiresTextConfirmation, true);
  const knownContext = { ...target, context: { ...target.context, text: "我", confirmed: true } };
  const literalSuffix = scopedContextResult({ ...recognition(snapshot), ocrCharacters: [] }, snapshot, knownContext);
  assert.equal(literalSuffix.recognizedText, "。");
  assert.equal(literalSuffix.requiresVerification, false);
  assert.deepEqual(literalSuffix.ocrCharacters, []);
  const changedContext = scopedContextResult({ ...recognition(snapshot), recognizedText: "你。", ocrCharacters: [] }, snapshot, knownContext);
  assert.equal(changedContext.requiresTextConfirmation, true);
});

const fullStop = (column, circle = false, id = "stop") => ({ id, width: 3, label: circle ? "。" : ".",
  points: circle ? Array.from({ length: 17 }, (_, index) => ({
    x: column * 96 + 15 + 5 * Math.cos(index * Math.PI / 8), y: 76 + 5 * Math.sin(index * Math.PI / 8), timestamp: index,
  })) : [{ x: column * 96 + 15, y: 76, timestamp: 30 }] });

test("a baseline dot or Chinese full stop completes a sentence without another OCR call", async () => {
  for (const circle of [false, true]) {
    const h = harness(), body = sample("我有书"), punctuation = fullStop(3, circle);
    h.checker.update({ revision: 1, strokes: body }); await h.checker.recogniseNow();
    assert.equal(h.calls.grammar.length, 0);
    h.checker.update({ revision: 2, strokes: [...body, punctuation] }); await h.checker.recogniseNow(); await settle();
    const text = "我有书" + punctuation.label;
    assert.equal(h.checker.getState().transcription.text, text);
    assert.equal(h.calls.recognise.length, 3); // Only the three character regions were sent.
    assert.deepEqual(h.calls.grammar.map((call) => call.text), [text]);
    const region = h.checker.getState().regions.at(-1);
    assert.equal(region.recognitionSource, "stroke_geometry");
    assert.equal(region.review.ocrSegments[0].confidence, null);
    assert.equal(h.checker.getState().transcription.characters.at(-1).bounds.x, punctuation.points[0].x - (circle ? 11.5 : 1.5));
    h.checker.update({ revision: 3, strokes: body }); await settle();
    assert.equal(h.checker.getState().sentences[0].complete, false);
    h.checker.update({ revision: 4, strokes: [...body, punctuation] }); await h.checker.recogniseNow(); await settle();
    assert.equal(h.calls.recognise.length, 3);
    assert.equal(h.calls.grammar.length, 1); // Undo restoration reuses both caches.
    h.checker.dispose();
  }
});

test("a full stop beside unchanged ink in the same square retains the character and its mapping", async () => {
  for (const circle of [false, true]) {
    const h = harness(), body = stroke("body", 0, "书"); body.points[1].x = 55;
    h.checker.update({ revision: 1, strokes: [body] }); await h.checker.recogniseNow();
    const mark = fullStop(0, circle); mark.points = mark.points.map((point) => ({ ...point, x: point.x + 65 }));
    h.checker.update({ revision: 2, strokes: [body, mark] }); await h.checker.recogniseNow(); await settle();
    assert.equal(h.checker.getState().transcription.text, "书" + mark.label);
    assert.equal(h.calls.recognise.length, 1);
    assert.equal(h.calls.grammar.length, 1);
    assert.equal(h.checker.getState().transcription.characters.length, 2);
    assert.equal(h.checker.getState().regions[0].rawReview.recognizedText, "书");
    h.checker.dispose();
  }
});

test("a full stop omitted from an otherwise accepted OCR result still completes the sentence", async () => {
  const h = harness({ recognise: (snapshot) => recognition({ ...snapshot, strokes: snapshot.strokes.slice(0, 1) }) });
  const body = stroke("body", 0, "书"); body.points[1].x = 55;
  const mark = fullStop(0); mark.points[0].x = 80;
  h.checker.update({ revision: 1, strokes: [body, mark] }); await h.checker.recogniseNow(); await settle();
  assert.equal(h.checker.getState().transcription.text, "书.");
  assert.equal(h.calls.grammar[0].text, "书.");
  assert.equal(h.checker.getState().regions[0].rawReview.recognizedText, "书");
  h.checker.dispose();
});

test("punctuation never bypasses an uncertain character and confirmation starts grammar once", async () => {
  const h = harness(), body = stroke("body", 0, "末", 0, true), mark = fullStop(1);
  h.checker.update({ revision: 1, strokes: [body, mark] }); await h.checker.recogniseNow(); await settle();
  assert.equal(h.calls.grammar.length, 0);
  const region = h.checker.getState().regions[0];
  h.checker.confirm(region.id, region.fingerprint, { 0: "末" }); await settle();
  assert.equal(h.checker.getState().transcription.text, "末.");
  assert.deepEqual(h.calls.grammar.map((call) => call.text), ["末."]);
  h.checker.update({ revision: 2, strokes: [mark] }); await settle();
  assert.equal(h.calls.grammar.length, 1); // A remaining punctuation mark is not a Mandarin sentence.
  h.checker.dispose();
});

test("full-stop detection rejects commas, upper dots, open rings, large circles and numeric decimals", () => {
  const body = stroke("body", 0, "书");
  const previous = { ...incrementalRegions([body])[0], confirmed: true, text: "书" };
  for (const mark of [
    { ...fullStop(1), points: [{ x: 111, y: 76 }, { x: 108, y: 84 }] }, // comma
    { ...fullStop(1), points: [{ x: 111, y: 76 }, { x: 120, y: 76 }] }, // dash
    { ...fullStop(1), points: [{ x: 111, y: 20 }] },
    { ...fullStop(1, true), points: fullStop(1, true).points.slice(0, 12) },
    { ...fullStop(1, true), points: fullStop(1, true).points.map((p) => ({ ...p, x: 115 + (p.x - 111) * 3, y: 65 + (p.y - 76) * 3 })) },
  ]) assert.equal(recogniseFullStop(incrementalRegions([mark])[0], [previous]), null);
  const group = incrementalRegions([fullStop(1)])[0];
  assert.equal(recogniseFullStop(group, [{ ...previous, text: "3" }]), null);
  assert.equal(recogniseFullStop(group, [{ ...previous, confirmed: false }]), null);
  const internal = fullStop(0); internal.points[0].x = 40;
  const within = incrementalRegions([body, internal])[0];
  assert.equal(recogniseFullStop(within, [], { ...previous, strokes: [body] }), null);
  const narrowBody = structuredClone(body); narrowBody.points[1].x = 55;
  const finalDot = fullStop(0); finalDot.points[0].x = 80;
  const narrow = incrementalRegions([narrowBody, finalDot])[0];
  assert.equal(recogniseFullStop(narrow, [], { ...previous, strokes: [narrowBody],
    characters: [{ bounds: { x: 9, y: 9, width: 75, height: 72 } }] }), null);
});

test("sentence segmentation handles Chinese/English endings, decimal numbers, and unfinished tails", () => {
  assert.deepEqual(sentenceRanges("我有3.5元。你好吗?!我很好！还有", true).map(({ text, complete }) => [text, complete]),
    [["我有3.5元。", true], ["你好吗?!", true], ["我很好！", true], ["还有", false]]);
});

test("redo restores exact stroke IDs, timestamps, and drawing sequence", () => {
  const first = sample("我"), both = appendStroke(first, stroke("later", 1, "有"));
  const undone = undoEdit([first], both);
  const redone = redoEdit([both], undone.history, undone.strokes);
  assert.equal(redone.strokes, both);
  assert.equal(redone.strokes[0], first[0]);
  assert.deepEqual(redone.strokes.map((entry) => entry.id), ["a0", "later"]);
  assert.equal(redone.strokes[1].points[0].timestamp, 10);
});

test("region export preserves world coordinates and rejects oversized groups", async () => {
  const group = incrementalRegions(sample("我"))[0];
  const calls = [];
  const createCanvas = () => ({ getContext: () => new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]), set: () => true }),
    toBlob: (callback) => callback(new Blob(["PNG"], { type: "image/png" })) });
  const exported = await exportRecognitionRegion(group, 4, createCanvas);
  assert.equal(exported.revision, 4); assert.deepEqual(exported.strokes, group.strokes);
  assert.ok(calls.some(([name]) => name === "translate"));
  const huge = stroke("large", 0); huge.points[1].x = 5000;
  await assert.rejects(exportRecognitionRegion(incrementalRegions([huge])[0], 5, createCanvas), /too large/);
});

test("recognition errors retry independently and dismissal/acceptance never change strokes or confirm intention", async () => {
  let fail = true;
  const h = harness({ recognise: (snapshot) => { if (fail) throw new Error("Recognition failed"); return recognition(snapshot); } });
  const ink = sample("我。"); const original = structuredClone(ink);
  h.checker.update({ revision: 1, strokes: ink }); await h.checker.recogniseNow();
  assert.equal(h.checker.getState().regions[0].status, "error");
  fail = false; await h.checker.recogniseNow(); await settle();
  const sentence = h.checker.getState().sentences[0];
  h.checker.dismiss("a suggestion"); h.checker.acceptSentence(sentence.fingerprint);
  assert.ok(h.checker.getState().dismissed.includes("a suggestion"));
  assert.deepEqual(ink, original); assert.equal(h.history().confirmations.length, 0); h.checker.dispose();
});

test("region observations preserve unrelated history and never retain exported PNG blobs", async () => {
  const h = harness(), ink = [stroke("first", 0, "末", 0, true), stroke("second", 1, "末", 0, true)];
  h.checker.update({ revision: 1, strokes: ink }); await h.checker.recogniseNow();
  assert.equal(h.history().occurrences.length, 2);
  assert.ok(h.history().occurrences.every((entry) => entry.status === "active" && entry.priority === "high"));
  assert.ok(h.checker.getState().regions.every((region) => region.snapshot.image === undefined));
  h.checker.update({ revision: 2, strokes: ink }); await h.checker.recogniseNow();
  assert.equal(h.calls.recognise.length, 2); assert.equal(h.history().occurrences.length, 2); h.checker.dispose();
});

test("empty character recognition keeps a real region highlight and offers confirmation/retry without history spam", async () => {
  let readable = false;
  const h = harness({ recognise: (snapshot) => readable ? recognition(snapshot) : {
    recognizedText: "", status: "LOW_CONFIDENCE", requiresVerification: true, revision: snapshot.revision,
    characterCandidates: [], intentTargets: [{ id: "missing", start: 0, end: 0, original: "" }], ocrCharacters: [], ocrSegments: [], ocrConfidence: null,
  } });
  const first = stroke("part-1", 0, "弟");
  h.checker.update({ revision: 1, strokes: [first] }); await h.checker.recogniseNow();
  let region = h.checker.getState().regions[0];
  assert.equal(region.review.requiresTextConfirmation, true);
  assert.equal(h.history().occurrences[0].locationKind, "region");
  assert.equal(h.history().occurrences[0].reliable, false);
  const second = stroke("part-2", 0, ""); second.points = [{ x: 70, y: 80 }, { x: 75, y: 85 }];
  h.checker.update({ revision: 2, strokes: [first, second] }); await h.checker.recogniseNow();
  assert.equal(h.history().occurrences.length, 1, "partial character updates must reuse the same check");
  region = h.checker.getState().regions[0]; readable = true;
  h.checker.dismiss(`region:${region.fingerprint}`);
  await h.checker.retryRegion(region.id, region.fingerprint);
  assert.equal(h.calls.recognise.length, 3); assert.equal(h.checker.getState().regions[0].text, "弟");
  assert.ok(!h.checker.getState().dismissed.includes(`region:${region.fingerprint}`));
  h.checker.dispose();
});

test("explicit one-character confirmation retains its location and records the intended confusion", async () => {
  const h = harness({ recognise: (snapshot) => ({ ...recognition(snapshot), status: "LOW_CONFIDENCE", requiresVerification: true,
    requiresTextConfirmation: true, characterCandidates: [], intentTargets: [], unresolvedRegions: [], clarificationMessage: "Check recovered text." }) });
  h.checker.update({ revision: 1, strokes: [stroke("di", 0, "弟")] }); await h.checker.recogniseNow();
  const region = h.checker.getState().regions[0];
  h.checker.confirm(region.id, region.fingerprint, {}, "第");
  const confirmed = h.checker.getState().regions[0];
  assert.equal(confirmed.characters[0].text, "第"); assert.ok(confirmed.characters[0].bounds);
  assert.equal(h.history().confirmations[0].recognized, "弟"); assert.equal(h.history().confirmations[0].intended, "第");
  h.checker.dispose();
});
