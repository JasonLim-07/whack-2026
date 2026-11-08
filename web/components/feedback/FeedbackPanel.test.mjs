import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Exercise the actual JSX with the compiler and React already used by Next.
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transform, loadBindings } = require("next/dist/build/swc");
await loadBindings();
const filename = fileURLToPath(new URL("./FeedbackPanel.jsx", import.meta.url));
const { code } = await transform(readFileSync(filename, "utf8"), {
  filename, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
});
const compiled = { exports: {} };
const panelRequire = (id) => require(id.startsWith("@/") ? fileURLToPath(new URL(`../../${id.slice(2)}`, import.meta.url)) : id);
new Function("require", "module", "exports", code)(panelRequire, compiled, compiled.exports);
const render = (props) => renderToStaticMarkup(React.createElement(compiled.exports.default, props));
const pending = { recognizedText: "我有三书。", status: "LOW_CONFIDENCE", requiresVerification: true, revision: 3,
  ocrConfidence: null, ocrSegments: [], characterCandidates: [{ position: 3, originalAttempt: "书", confidence: 0.75,
    options: [{ char: "书", reason: "Original" }, { char: "韦", reason: "Suggestion" }] }] };
const intent = { ...pending, characterCandidates: [], intentTargets: [{ id: "low", start: 3, end: 4, original: "书" }] };
const suggestions = { low: [{ text: "书", explanation: "A book." }, { text: "树", explanation: "A tree." }] };

test("medium panel shows supplied choices without selecting one or showing premature grammar", () => {
  const initial = render({ review: pending });
  assert.match(initial, /type="radio"/);
  assert.doesNotMatch(initial, /checked=""|Grammar Suggestions|Tell us.*English/);
  assert.match(initial, /disabled=""/);
  const selected = render({ review: pending, selections: { 3: "书" } });
  assert.match(selected, /checked=""/);
  assert.doesNotMatch(selected, /disabled=""/);
});

test("low panel asks English intent and requires explicit selection even after suggestions arrive", () => {
  const initial = render({ review: intent });
  assert.match(initial, /Tell us what you meant in English/);
  assert.doesNotMatch(initial, /textarea|type="radio"|Grammar Suggestions/);
  const suggested = render({ review: intent, intentDescriptions: { low: "book" }, intentSuggestions: suggestions });
  assert.match(suggested, /A book/);
  assert.match(suggested, /A tree/);
  assert.doesNotMatch(suggested, /checked=""/);
  assert.match(suggested, /disabled=""/);
  const chosen = render({ review: intent, intentDescriptions: { low: "book" }, intentSuggestions: suggestions, selections: { low: "书" } });
  assert.doesNotMatch(chosen, /disabled=""/);
  assert.match(chosen, /我有三书。/);
});

test("missing part uses the same intent UI and ambiguous placement uses a simple editor", () => {
  const missing = render({ review: { ...intent, recognizedText: "我有三。", intentTargets: [{ id: "missing", start: 3, end: 3, original: "" }] } });
  assert.match(missing, /Tell us what you meant in English/);
  assert.match(missing, /extra mark/);
  assert.doesNotMatch(missing, /grid|row|column|textarea/i);
  const ambiguous = render({ review: { ...intent, requiresTextConfirmation: true, intentTargets: [], unresolvedRegions: [], clarificationMessage: "Check order." }, confirmedText: "我有三书。" });
  assert.match(ambiguous, /textarea/);
  assert.doesNotMatch(ambiguous, /type="checkbox"|disabled=""|grid/i);
});

test("suggestion loading and changed-drawing states hide obsolete confirmation controls", () => {
  assert.match(render({ review: intent, loading: true, suggesting: true }), /Finding Chinese suggestions/);
  const stale = render({ review: intent, stale: true });
  assert.match(stale, /Writing changed/);
  assert.doesNotMatch(stale, /Suggest Chinese|type="radio"/);
});

test("confirmed review displays existing grammar feedback", () => {
  const result = render({ review: { recognizedText: "我有三书。", correctedText: "我有三本书。", ocrConfidence: null,
    issues: [{ id: "one", type: "grammar", start: 2, end: 4, original: "三书", replacement: "三本书", explanation: "Use 本 for books." }] } });
  assert.match(result, /我有三本书。/);
  assert.match(result, /Use 本 for books/);
  assert.doesNotMatch(result, /Suggest Chinese|type="radio"/);
});

test("grammar cards and typed highlights retain selection alongside verification controls", () => {
  const review = { recognizedText: "我有三书。", correctedText: "我有三本书。", ocrConfidence: null,
    issues: [{ id: "one", type: "grammar", start: 3, end: 3, original: "", replacement: "本", explanation: "Use 本 for books." }] };
  const selected = render({ review, selectedIssueId: "one" });
  assert.match(selected, /aria-pressed="true"/);
  assert.match(selected, /aria-label="Suggested insertion"/);
  assert.match(selected, /bg-blue-200/);
  const loading = render({ review: intent, loading: true, suggesting: true });
  assert.match(loading, /Finding Chinese suggestions/);
  assert.match(loading, /role="status"/);
});

test("visual warning reuses character choices without claiming a stroke mistake", () => {
  const review = { ...pending, characterCandidates: pending.characterCandidates.map((candidate) => ({ ...candidate, visuallyUncertain: true })) };
  const panel = render({ review });
  assert.match(panel, /Check this character/);
  assert.match(panel, /type="radio"/);
  assert.doesNotMatch(panel, /missing stroke|incorrect stroke|checked=""/i);
  assert.match(panel, /disabled=""/);
});

test("uncertain handwriting has typed emphasis and a focusable correction target before grammar", () => {
  const html = render({ review: pending, selectedIssueId: "mistake-1", reviewHighlights: [{ id: "mistake-1", start: 3, end: 4 }] });
  assert.match(html, /<mark/); assert.match(html, /bg-blue-200/);
  assert.match(html, /id="character-choice-3" tabindex="-1"/);
  assert.doesNotMatch(html, /Grammar Suggestions/);
});

test("one compact personalisation tip appears only with completed grammar feedback", () => {
  const tip = "Measure words have come up again. Books use 本.";
  const review = { recognizedText: "我有三书。", correctedText: "我有三本书。", ocrConfidence: null,
    issues: [{ id: "one", type: "grammar", category: "measure_word", start: 2, end: 4, original: "三书", replacement: "三本书", explanation: "Use 本 for books." }] };
  const html = render({ review, personalisedTip: tip, onResetHistory() {} });
  assert.equal(html.split(tip).length - 1, 1);
  assert.match(html, /Reset learning history/);
  assert.match(html, /Use 本 for books/);
  assert.doesNotMatch(render({ review: pending, personalisedTip: tip }), /Measure words have come up again/);
  assert.doesNotMatch(render({ review, stale: true, personalisedTip: tip }), /Measure words have come up again/);
<<<<<<< HEAD
=======
});

test("correct reviews have a single positive message without a repeated corrected sentence", () => {
  const html = render({ review: { recognizedText: "我是学生。", correctedText: "我是学生。", issues: [], ocrConfidence: null } });
  assert.match(html, /Your writing/);
  assert.match(html, /Looks good/);
  assert.equal((html.match(/lang="zh-Hans"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Your learning tip|Confidence unavailable/);
});

test("multiple grammar choices retain issue selection and show one explanation at a time", () => {
  const review = { recognizedText: "我有三书。", correctedText: "我有三本书。", ocrConfidence: null, issues: [
    { id: "one", type: "grammar", start: 2, end: 4, original: "三书", replacement: "三本书", explanation: "Use 本 for books." },
    { id: "two", type: "word_choice", start: 0, end: 1, original: "我", replacement: "你", explanation: "Second explanation shown on selection." },
  ] };
  const first = render({ review });
  assert.match(first, /Choose a change/);
  assert.match(first, /Use 本 for books/);
  assert.doesNotMatch(first, /Second explanation/);
  const second = render({ review, selectedIssueId: "two", onSelectIssue() {} });
  assert.match(second, /Second explanation shown on selection/);
  assert.doesNotMatch(second, /Use 本 for books/);
  assert.match(second, /Show feedback for this character/);
  assert.match(second, /bg-blue-200/);
});

test("long explanations stay behind closed details and learning tip follows correction in purple", () => {
  const explanation = `Books use 本. ${"A longer supporting explanation. ".repeat(12)}`;
  const html = render({ review: { recognizedText: "我有三书。", correctedText: "我有三本书。", ocrConfidence: null,
    issues: [{ id: "one", type: "grammar", start: 2, end: 4, original: "三书", replacement: "三本书", explanation }] },
    personalisedTip: "A reminder from learner memory." });
  assert.match(html, /Books use 本/);
  assert.match(html, /<details[^>]*><summary[^>]*>Explanation details/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /bg-violet-50/);
  assert.ok(html.indexOf("Your writing") < html.indexOf("Suggested correction"));
  assert.ok(html.indexOf("Suggested correction") < html.indexOf("Your learning tip"));
});

test("empty, loading and retry states remain concise and accessible", () => {
  assert.match(render({ review: null }), /Write a Mandarin sentence to begin/);
  assert.match(render({ review: null, loading: true }), /Analysing your writing/);
  const failed = render({ review: null, error: "Please try again." });
  assert.match(failed, /role="alert"/); assert.match(failed, /Try again/);
>>>>>>> feature/sidebar-cleanup
});
