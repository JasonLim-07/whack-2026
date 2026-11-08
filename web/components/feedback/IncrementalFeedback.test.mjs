import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url), React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transform, loadBindings } = require("next/dist/build/swc");
await loadBindings();
async function compile(name, overrides = {}) {
  const filename = fileURLToPath(new URL(name, import.meta.url));
  const { code } = await transform(readFileSync(filename, "utf8"), {
    filename, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" },
  });
  const output = { exports: {} };
  const localRequire = (id) => overrides[id] ?? require(id.startsWith("@/") ? fileURLToPath(new URL(`../../${id.slice(2)}`, import.meta.url)) : id);
  new Function("require", "module", "exports", code)(localRequire, output, output.exports);
  return output.exports;
}
const FeedbackPanel = await compile("./FeedbackPanel.jsx");
const Component = (await compile("./IncrementalFeedback.jsx", { "./FeedbackPanel": FeedbackPanel })).default;
const review = { recognizedText: "末", revision: 2, ocrConfidence: null, ocrSegments: [], ocrCharacters: [], status: "LOW_CONFIDENCE", requiresVerification: true,
  characterCandidates: [{ position: 0, originalAttempt: "末", confidence: null, options: [{ char: "末", reason: "Original" }, { char: "未", reason: "Alternative" }] }] };
const region = { id: "0:0:0:0", fingerprint: "ink-1", top: 0, left: 0, text: "末", review, confirmed: false, status: "ready" };
const state = { regions: [region], sentences: [], transcription: { text: "末" }, dismissed: [] };
const render = (props = {}) => renderToStaticMarkup(React.createElement(Component, { state, checker: {}, onDismissRegion() {}, ...props }));

test("character uncertainties have separate correction controls and namespaced radio groups", () => {
  const html = render();
  assert.match(html, /Digital transcription/); assert.match(html, /Character checks/);
  assert.match(html, /name="region-0:0:0:0-character-0"/);
  assert.match(html, /Confirm text and review/); assert.match(html, /Stroke-order checking is not yet available/);
});

test("grammar is blocked until uncertain text is confirmed and writing hides stale controls", () => {
  const blocked = render({ state: { ...state, sentences: [{ text: "末。", fingerprint: "sentence", status: "blocked" }] } });
  assert.match(blocked, /Confirm the uncertain handwriting/);
  const editing = render({ editing: true });
  assert.match(editing, /Writing is changing/); assert.doesNotMatch(editing, /type="radio"/);
});

test("grammar corrections, dismissal, details and digital acceptance remain separate from handwriting", () => {
  const sentence = { text: "我有三书。", fingerprint: "sentence", status: "ready", accepted: true,
    result: { correctedText: "我有三本书。", issues: [{ id: "one", type: "grammar", original: "三书", replacement: "三本书", explanation: "Books use 本." }] } };
  const html = render({ state: { ...state, regions: [], sentences: [sentence] } });
  assert.match(html, /GCSE grammar/); assert.match(html, /Explanation details/);
  assert.match(html, /Dismiss suggestion/); assert.match(html, /Digital correction:/);
  const dismissed = render({ state: { ...state, regions: [], sentences: [sentence], dismissed: ["grammar:sentence:one"] } });
  assert.doesNotMatch(dismissed, /Books use 本/);
});

test("recognition errors and loading do not claim that handwriting is correct", () => {
  assert.match(render({ state: { ...state, regions: [{ ...region, status: "loading" }] } }), /Recognising this region/);
  const failed = render({ state: { ...state, regions: [{ ...region, status: "error", error: "Provider unavailable" }] } });
  assert.match(failed, /Provider unavailable/); assert.match(failed, /Retry character checking/);
  assert.doesNotMatch(failed, /No supported character concerns detected/);
});

test("unread squares offer a visible text confirmation and retry instead of unexplained empty glyphs", () => {
  const unread = { ...region, text: "", review: { ...review, recognizedText: "", characterCandidates: [],
    requiresTextConfirmation: true, unresolvedRegions: [], clarificationMessage: "Enter the intended Chinese text or retry." } };
  const html = render({ state: { ...state, regions: [unread], transcription: { text: "\uFFFC" } } });
  assert.match(html, /\[unread\]/); assert.match(html, /Some writing could not be recognised/);
  assert.match(html, /<textarea/); assert.match(html, /Retry recognition/);
});
