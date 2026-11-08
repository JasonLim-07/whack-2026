import test from "node:test";
import assert from "node:assert/strict";
import { validTextRange, validOcrCharacters, handwritingHighlights, textHighlights } from "./locations.mjs";
import { renderGrammarHighlights, renderWhiteboard } from "../handwriting/render.mjs";

const text = "\u{20000}\u4e2a\u4e2a";
const issue = { id: "second", start: 2, end: 3, original: "\u4e2a" };
const characters = Array.from(text, (text, start) => ({ text, start, end: start + 1, bounds: { x: 10 + start * 20, y: 30, width: 15, height: 25 } }));

test("ranges address Unicode code points and distinguish repeated substrings", () => {
  assert.equal(text.length, 4);
  assert.equal(Array.from(text).length, 3);
  assert.equal(validTextRange(text, 2, 3, "\u4e2a"), true);
  assert.equal(validTextRange(text, 0, 1, "\u{20000}"), true);
  for (const [start, end, original] of [[0,2,"\u{20000}"],[-1,0,""],[1,4,"\u4e2a"],[2,1,""],[1.5,2,""],["1",2,"\u4e2a"]]) {
    assert.equal(validTextRange(text, start, end, original), false);
  }
});

test("OCR locations require exact transcription alignment and valid optional geometry", () => {
  assert.equal(validOcrCharacters(characters, text), true);
  assert.equal(validOcrCharacters([], text), true);
  assert.equal(validOcrCharacters(characters.map((entry) => ({ ...entry, bounds: null })), text), true);
  assert.equal(validOcrCharacters(characters.slice(1), text), false);
  assert.equal(validOcrCharacters([{ ...characters[0], bounds: { x: -1, y: 0, width: 10, height: 10 } }], text), false);
  assert.equal(validOcrCharacters([{ ...characters[0], bounds: { x: 0, y: 0, width: NaN, height: 10 } }], text), false);
});

test("canvas highlights add the saved negative export origin and never guess missing regions", () => {
  const review = { issues: [issue, { id: "insert", start: 1, end: 1 }], ocrCharacters: characters };
  const rectangles = handwritingHighlights(review, { left: -200, top: -100 });
  assert.deepEqual(rectangles, [{ issueId: "second", x: -150, y: -70, width: 15, height: 25 }]);
  assert.deepEqual(handwritingHighlights({ ...review, ocrCharacters: characters.map((entry) => ({ ...entry, bounds: null })) }, { left: 0, top: 0 }), []);
  assert.deepEqual(handwritingHighlights(review, null), []);
});

test("text runs support overlapping issues and zero-length insertions without losing original text", () => {
  const issues = [issue, { id: "span", start: 0, end: 3 }, { id: "insert", start: 3, end: 3 }];
  const runs = textHighlights(text, issues);
  assert.equal(runs.filter((run) => !run.insertion).map((run) => run.text).join(""), text);
  assert.deepEqual(runs[2].issueIds, ["second", "span"]);
  assert.deepEqual(runs[3], { key: "insert-3", text: "│", insertion: true, issueIds: ["insert"] });
});

test("grammar overlays share transforms, restore state and render before permanent ink", () => {
  for (const zoom of [0.25, 1]) {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_, name) => (...args) => calls.push([name, ...args]),
      set: (_, name, value) => { calls.push(["set", name, value]); return true; },
    });
    const viewport = { zoom, offsetX: -48, offsetY: 91 };
    const size = { width: 640, height: 480, dpr: 2 };
    const rectangles = [{ issueId: "second", x: -150, y: -70, width: 15, height: 25 }];
    renderWhiteboard(ctx, size, viewport, [{ points: [{ x: 1, y: 1 }], color: "black", width: 3 }], null,
      () => renderGrammarHighlights(ctx, size, viewport, rectangles, "second"));
    const selected = calls.findIndex(([name]) => name === "strokeRect");
    const ink = calls.findIndex(([name]) => name === "arc");
    assert.ok(selected > 0 && selected < ink);
    assert.deepEqual(calls[selected], ["strokeRect", -152, -72, 19, 29]);
    assert.ok(calls.some(([name, key, value]) => name === "set" && key === "lineWidth" && value === 1.5 / zoom));
    assert.equal(calls.filter(([name]) => name === "save").length, calls.filter(([name]) => name === "restore").length);
  }
});
