import assert from "node:assert/strict";
import test from "node:test";
import { createLearnerMemory } from "./memory.mjs";

const storage = () => {
  let value = null;
  return { getItem: () => value, setItem: (_, next) => { value = next; }, raw: () => value };
};
const issue = (category = "measure_word", extra = {}) => ({ id: "one", type: "grammar", category,
  original: "三书", replacement: "三本书", explanation: "Use 本 for books.", start: 2, end: 4, ...extra });
const review = (revision, issues = [issue()]) => ({ recognizedText: "我有三书。", correctedText: "我有三本书。", issues, revision });
const record = (memory, revision, issues) => memory.recordCompletedReview(review(revision, issues), { sessionId: "workspace-a", revision });

test("different incorrect/missing measure words count twice and produce one relevant tip", () => {
  const saved = storage();
  const memory = createLearnerMemory(saved);
  const first = { recognizedText: "我有三个书。", correctedText: "我有三本书。", revision: 1,
    issues: [issue("measure_word", { original: "个", replacement: "本", start: 3, end: 4 })] };
  memory.recordCompletedReview(first, { sessionId: "workspace-a", revision: 1 });
  assert.equal(memory.getPersonalisedTip(first), null);
  record(memory, 2);
  assert.equal(memory.getDifficultyCategories().categories.measure_word, 2);
  assert.match(memory.getPersonalisedTip(review(2)), /Measure words.*三本书/);
  assert.equal(createLearnerMemory(saved).getDifficultyCategories().categories.measure_word, 2);
  assert.doesNotMatch(saved.raw(), /我有|三个书|三本书|explanation|image/);
});

test("unchanged automatic/manual/confirmed reviews and older responses count once", () => {
  const saved = storage();
  const memory = createLearnerMemory(saved);
  assert.equal(record(memory, 10), true);
  assert.equal(record(memory, 10), false);
  assert.equal(record(createLearnerMemory(saved), 10), false);
  assert.equal(record(memory, 9), false);
  record(memory, 11, [issue(), issue("measure_word", { id: "two" })]);
  assert.equal(memory.getDifficultyCategories().categories.measure_word, 2);
  const returned = memory.getDifficultyCategories();
  returned.categories.measure_word = 100;
  assert.equal(memory.getDifficultyCategories().categories.measure_word, 2);
});

test("same revision in a separate workspace is a distinct writing attempt", () => {
  const memory = createLearnerMemory(null);
  record(memory, 1);
  memory.recordCompletedReview(review(1), { sessionId: "workspace-b", revision: 1 });
  assert.equal(memory.getDifficultyCategories().categories.measure_word, 2);
});

test("word-order subcategories persist and specific tips require repeated evidence", () => {
  const memory = createLearnerMemory(storage());
  record(memory, 1, [issue("word_order", { subcategory: "time_placement" })]);
  record(memory, 2, [issue("word_order", { subcategory: "location_placement" })]);
  assert.match(memory.getPersonalisedTip(review(2, [issue("word_order", { subcategory: "location_placement" })])), /^Word order/);
  record(memory, 3, [issue("word_order", { subcategory: "time_placement" })]);
  assert.equal(memory.getDifficultyCategories().wordOrderSubcategories.time_placement, 2);
  assert.equal(memory.getDifficultyCategories().wordOrderSubcategories.location_placement, 1);
  assert.match(memory.getPersonalisedTip(review(3, [issue("word_order", { subcategory: "time_placement" })])), /^Time placement/);
});

test("correct sentences create no mistakes and never show an unrelated historical tip", () => {
  const memory = createLearnerMemory(null);
  record(memory, 1); record(memory, 2);
  const correct = { recognizedText: "我是学生。", correctedText: "我是学生。", issues: [], revision: 3 };
  assert.equal(memory.recordCompletedReview(correct, { sessionId: "workspace-a", revision: 3 }), true);
  assert.equal(memory.getPersonalisedTip(correct), null);
  assert.equal(record(memory, 3), false); // A different model answer cannot recount unchanged ink.
  assert.equal(memory.getDifficultyCategories().categories.measure_word, 2);
});

test("pending OCR and errors do not consume the attempt; confirmation can count later", () => {
  const memory = createLearnerMemory(null);
  for (const extra of [{ requiresVerification: true }, { requiresTextConfirmation: true }, { status: "LOW_CONFIDENCE" },
    { status: "UNREADABLE" }, { unresolvedRegions: [{}] }, { error: { code: "TEST" } }]) {
    assert.equal(memory.recordCompletedReview({ ...review(1), ...extra }, { sessionId: "workspace-a", revision: 1 }), false);
  }
  assert.equal(record(memory, 1), true);
  assert.equal(memory.getDifficultyCategories().categories.measure_word, 1);
});

test("character warnings, no-op advisories, legacy and malformed classifications do not count", () => {
  const memory = createLearnerMemory(null);
  record(memory, 1, [issue("measure_word", { type: "character" }), issue("measure_word", { visuallyUncertain: true }),
    issue("measure_word", { original: "三书", replacement: "三书" }), issue(undefined, { category: undefined }),
    issue("unsupported"), issue("measure_word", { start: 30 }), issue("measure_word", { subcategory: "time_placement" })]);
  assert.equal(memory.getDifficultyCategories().categories.measure_word, 0);
  assert.equal(memory.getPersonalisedTip(review(1)), null);
});

test("invalid/unavailable/full storage does not crash and preserves session deduplication", () => {
  for (const saved of [null, { getItem() { throw new Error("blocked"); } },
    { getItem: () => "broken JSON", setItem() {} },
    { getItem: () => JSON.stringify({ version: 99 }), setItem() { throw new Error("full"); } },
    { getItem: () => null, setItem() { throw new Error("full"); } }]) {
    const memory = createLearnerMemory(saved);
    record(memory, 1); record(memory, 1); record(memory, 2);
    assert.equal(memory.getDifficultyCategories().categories.measure_word, 2);
    assert.doesNotThrow(() => memory.resetLearningHistory());
    assert.equal(memory.getDifficultyCategories().categories.measure_word, 0);
  }
});

test("invalid stored counts are discarded and resetting persists", () => {
  const saved = storage();
  const memory = createLearnerMemory(saved);
  record(memory, 1);
  const invalid = JSON.parse(saved.raw()); invalid.categories.measure_word = -2;
  saved.setItem("", JSON.stringify(invalid));
  assert.equal(createLearnerMemory(saved).getDifficultyCategories().categories.measure_word, 0);
  record(memory, 2);
  memory.resetLearningHistory();
  assert.equal(createLearnerMemory(saved).getDifficultyCategories().categories.measure_word, 0);
  assert.equal(record(memory, 2), true);
});

test("invalid identity/revision or incomplete results are ignored", () => {
  const memory = createLearnerMemory(null);
  for (const identity of [{}, { sessionId: "a", revision: -1 }, { sessionId: "a", revision: 2 }]) {
    assert.equal(memory.recordCompletedReview(review(1), identity), false);
  }
  for (const result of [null, {}, { ...review(1), issues: null }]) assert.equal(memory.recordCompletedReview(result, { sessionId: "a", revision: 1 }), false);
  assert.equal(memory.getDifficultyCategories().categories.measure_word, 0);
});

test("default memory survives a browser localStorage getter throwing a security error", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { throw new Error("SecurityError"); } } });
  try {
    const memory = createLearnerMemory();
    record(memory, 1); record(memory, 2);
    assert.equal(memory.getDifficultyCategories().categories.measure_word, 2);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});

test("a later quota failure keeps newly recorded counts and deduplication in memory", () => {
  const saved = storage();
  const first = createLearnerMemory(saved); record(first, 1);
  const full = { getItem: saved.getItem, setItem() { throw new Error("QuotaExceededError"); } };
  const memory = createLearnerMemory(full);
  record(memory, 2); record(memory, 2);
  assert.equal(memory.getDifficultyCategories().categories.measure_word, 2);
});
