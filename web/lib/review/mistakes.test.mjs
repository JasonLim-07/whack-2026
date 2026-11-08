import test from "node:test";
import assert from "node:assert/strict";
import { emptyMistakeHistory, mistakeReducer, extractMistakes, mistakeOverlays, pendingWarnings, priorityForEvidence } from "./mistakes.mjs";

const stroke = (id, x = 10) => ({ id, width: 2, points: [{ x, y: 10 }] });
const box = (x = 0) => ({ x, y: 0, width: 20, height: 20 });
function fixture(ids = ["a"], recognized = "末", alternative = "未", x = 0) {
  const review = { revision: 1, recognizedText: recognized, requiresVerification: true, ocrConfidence: null, ocrSegments: [],
    characterCandidates: [{ position: 0, originalAttempt: recognized, confidence: 0.95,
      options: [{ char: recognized, reason: "Original" }, { char: alternative, reason: "Suggestion" }] }],
    ocrCharacters: [{ text: recognized, start: 0, end: 1, bounds: box(x) }] };
  const snapshot = { bounds: { left: -100, top: -20 }, strokes: ids.map((id) => stroke(id, x - 90)), revision: 1 };
  snapshot.strokes = snapshot.strokes.map((entry) => ({ ...entry, points: entry.points.map((point) => ({ ...point, y: -10 })) }));
  return { review, snapshot, type: "review" };
}
const observe = (state, data = fixture()) => mistakeReducer(state, data);
const confirm = (state, review, intended = "未") => mistakeReducer(state, { type: "confirm", review, selections: { 0: intended } });

test("first uncertainty is low even with high OCR confidence and shape advisory", () => {
  const data = fixture(); data.review.characterCandidates[0].visuallyUncertain = true;
  const state = observe(emptyMistakeHistory(), data);
  assert.equal(state.occurrences[0].priority, "low");
  assert.equal(state.occurrences[0].category, "shape");
  assert.equal(pendingWarnings(state).length, 0);
  assert.deepEqual(mistakeOverlays(state), [{ ...box(-100), y: -20, issueId: "mistake-1" }]);
});

test("two fresh attempts promote existing notifications without duplicating unchanged reviews", () => {
  const a = fixture(), b = fixture(["b"]);
  let state = observe(emptyMistakeHistory(), a);
  state = observe(state, a); state = observe(state, { ...a, review: { ...a.review, revision: 2 } });
  assert.equal(state.occurrences.length, 1);
  state = observe(state, b);
  assert.equal(state.occurrences.length, 2);
  assert.deepEqual(state.occurrences.map((entry) => entry.priority), ["high", "high"]);
  assert.equal(state.occurrences[0].id, "mistake-1");
});

test("overlapping suggestions and different advisory categories do not imply the same mistake", () => {
  let state = observe(emptyMistakeHistory(), fixture());
  state = observe(state, fixture(["b"], "木", "未", 30));
  const shape = fixture(["c"], "末", "未", 60); shape.review.characterCandidates[0].visuallyUncertain = true;
  state = observe(state, shape);
  assert.ok(state.occurrences.every((entry) => entry.priority === "low"));
});

test("confirmed directional confusion is stronger than suspicion and requires compatible alternatives", () => {
  const first = fixture();
  let state = confirm(observe(emptyMistakeHistory(), first), first.review);
  assert.equal(state.confirmations.length, 1);
  state = observe(state, fixture(["b"], "末", "未", 30));
  assert.equal(state.occurrences[1].evidence, "confirmed");
  state = observe(state, fixture(["c"], "未", "末", 60));
  assert.equal(state.occurrences[2].priority, "low");
  const incompatible = fixture(["d"], "末", "木", 90);
  state = observe(state, incompatible);
  assert.notEqual(state.occurrences[3].evidence, "confirmed");
});

test("confirming the original dismisses suspicion; reconfirmation replaces evidence and survives grammar failure", () => {
  const first = fixture();
  let state = observe(emptyMistakeHistory(), first);
  state = confirm(state, first.review); state = confirm(state, first.review);
  assert.equal(state.confirmations.length, 1);
  state = confirm(state, first.review, "末");
  assert.equal(state.confirmations.length, 1);
  assert.equal(state.confirmations[0].intended, "末");
  assert.equal(state.occurrences[0].status, "resolved");
  state = observe(state, fixture(["b"]));
  assert.equal(state.occurrences[1].priority, "low");
  assert.equal(JSON.parse(JSON.stringify(state)).confirmations[0].version, 1);
});

test("partial edits and unrelated revisions retain attempt identity; a full rewrite counts again", () => {
  let state = observe(emptyMistakeHistory(), fixture(["a", "b"]));
  const partial = fixture(["a", "c"]);
  state = mistakeReducer(state, { type: "drawing", strokes: partial.snapshot.strokes });
  assert.equal(state.occurrences[0].status, "needs-review");
  assert.equal(mistakeOverlays(state).length, 0);
  state = observe(state, partial);
  assert.equal(state.occurrences.length, 1);
  state = mistakeReducer(state, { type: "drawing", strokes: [...partial.snapshot.strokes, stroke("elsewhere", 500)] });
  assert.equal(state.occurrences[0].status, "active");
  state = observe(state, fixture(["new"]));
  assert.equal(state.occurrences.length, 2);
  assert.equal(state.occurrences[1].priority, "high");
});

test("undo, clear, and restoring known strokes do not create repetitions or repeated warnings", () => {
  const first = fixture(), second = fixture(["b"]);
  let state = observe(observe(emptyMistakeHistory(), first), second);
  state = mistakeReducer(state, { type: "acknowledge", ids: state.occurrences.map((entry) => entry.id) });
  state = mistakeReducer(state, { type: "drawing", strokes: [] });
  assert.equal(pendingWarnings(state).length, 0); assert.equal(mistakeOverlays(state).length, 0);
  state = mistakeReducer(state, { type: "drawing", strokes: first.snapshot.strokes });
  state = observe(state, first);
  assert.equal(state.occurrences.length, 2);
  assert.equal(pendingWarnings(state).length, 0);
});

test("unlocated, ambiguous and multi-character findings remain accessible without repetition evidence", () => {
  const unlocated = fixture(); unlocated.review.ocrCharacters = [];
  let state = observe(emptyMistakeHistory(), unlocated);
  state = observe(state, unlocated);
  const second = fixture(["b"]); second.review.ocrCharacters = [];
  state = observe(state, second);
  assert.equal(state.occurrences.length, 2);
  assert.ok(state.occurrences.every((entry) => entry.priority === "low" && !entry.reliable));
  assert.equal(mistakeOverlays(state).length, 0);
  const multiple = fixture(["c"], "末未"); multiple.review.characterCandidates = [];
  multiple.review.intentTargets = [{ id: "unclear", start: 0, end: 2, original: "末未" }];
  assert.equal(extractMistakes(multiple.review, multiple.snapshot)[0].reliable, false);
});

test("updated OCR amends an existing record without double counting and clean reviews resolve it", () => {
  const first = fixture(); let state = observe(emptyMistakeHistory(), first);
  const changed = fixture(["a"], "木", "本");
  state = observe(state, changed);
  assert.equal(state.occurrences.length, 1);
  assert.equal(state.occurrences[0].recognized, "木");
  state = observe(state, { ...changed, review: { ...changed.review, characterCandidates: [] } });
  assert.equal(state.occurrences[0].status, "resolved");
});

test("same stroke shared by OCR slots cannot prove independent character attempts", () => {
  const data = fixture();
  data.review.recognizedText = "末末";
  data.review.characterCandidates.push({ ...data.review.characterCandidates[0], position: 1 });
  data.review.ocrCharacters.push({ ...data.review.ocrCharacters[0], start: 1, end: 2 });
  assert.ok(extractMistakes(data.review, data.snapshot).every((entry) => !entry.reliable));
});

test("thresholds are configurable and history remains immutable", () => {
  const initial = emptyMistakeHistory(); const first = observe(initial, fixture());
  const second = mistakeReducer(first, { ...fixture(["b"]), rules: { suspectedAttempts: 3 } });
  assert.equal(initial.occurrences.length, 0); assert.equal(first.occurrences[0].priority, "low");
  assert.ok(second.occurrences.every((entry) => entry.priority === "low"));
});

test("unlocated findings update in place when unrelated ink changes the export", () => {
  const first = fixture(); first.review.ocrCharacters = [];
  let state = observe(emptyMistakeHistory(), first);
  const updated = { ...first, snapshot: { ...first.snapshot, strokes: [...first.snapshot.strokes, stroke("elsewhere", 500)] } };
  state = observe(state, updated);
  assert.equal(state.occurrences.length, 1);
  assert.equal(state.occurrences[0].priority, "low");
});

test("resolved high warnings do not reappear for the same ink after updated OCR", () => {
  const first = fixture(), second = fixture(["b"]);
  let state = observe(observe(emptyMistakeHistory(), first), second);
  const clean = { ...second, review: { ...second.review, characterCandidates: [] } };
  state = observe(state, clean);
  state = observe(state, second);
  assert.ok(!pendingWarnings(state).some((entry) => entry.id === "mistake-2"));
});

test("only explicitly proven incorrectness can promote a first-time finding immediately", () => {
  assert.equal(priorityForEvidence({}), "low");
  assert.equal(priorityForEvidence({ provenIncorrect: true }), "high");
});

test("edited ink reopens a confirmed occurrence and a new confirmation replaces its old pair", () => {
  const first = fixture(["a", "b"]);
  let state = confirm(observe(emptyMistakeHistory(), first), first.review);
  const partial = fixture(["a", "c"]);
  state = mistakeReducer(state, { type: "drawing", strokes: partial.snapshot.strokes });
  assert.equal(state.occurrences[0].status, "needs-review");
  state = observe(state, partial);
  assert.equal(state.occurrences[0].status, "active");
  state = confirm(state, partial.review, "末");
  assert.equal(state.confirmations.length, 1);
  assert.equal(state.confirmations[0].intended, "末");
  assert.equal(state.occurrences[0].status, "resolved");
});

test("multi-character and whole-text confirmation resolves notifications without inventing character pairs", () => {
  const data = fixture(["a"], "末未");
  data.review.characterCandidates = [];
  data.review.intentTargets = [{ id: "part", start: 0, end: 2, original: "末未" }];
  const state = mistakeReducer(observe(emptyMistakeHistory(), data), { type: "confirm", review: data.review,
    selections: { part: "未来" }, intentSuggestions: { part: [{ text: "未来" }] } });
  assert.equal(state.occurrences[0].status, "resolved");
  assert.equal(state.confirmations.length, 0);
});

test("late cancelled reviews cannot reach history through the review runner", async () => {
  const { createReviewRunner } = await import("./client.mjs");
  const data = fixture(); let release;
  const response = new Promise((resolve) => { release = resolve; });
  let state = emptyMistakeHistory();
  const runner = createReviewRunner(() => response);
  const pending = runner.run({ exportSnapshot: async () => ({ ...data.snapshot, image: new Blob() }), revision: 1,
    isCurrent: () => true, onStart() {}, onFinish() {}, onError() {},
    onSuccess(review, snapshot) { state = mistakeReducer(state, { type: "review", review, snapshot }); } });
  await Promise.resolve();
  runner.cancel(); release(data.review); await pending;
  assert.equal(state.occurrences.length, 0);
});

test("a retracted detection stops contributing suspected evidence", () => {
  const first = fixture(); let state = observe(emptyMistakeHistory(), first);
  state = observe(state, { ...first, review: { ...first.review, characterCandidates: [] } });
  state = observe(state, fixture(["b"]));
  assert.equal(state.occurrences[1].priority, "low");
});

test("removing high-priority ink retires its warning even without explicit dismissal", () => {
  const first = fixture(), second = fixture(["b"]);
  let state = observe(observe(emptyMistakeHistory(), first), second);
  assert.equal(pendingWarnings(state).length, 1);
  state = mistakeReducer(state, { type: "drawing", strokes: [] });
  state = mistakeReducer(state, { type: "drawing", strokes: second.snapshot.strokes });
  state = observe(state, second);
  assert.equal(pendingWarnings(state).length, 0);
});
