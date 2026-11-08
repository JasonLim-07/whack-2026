import test from "node:test";
import assert from "node:assert/strict";
import { eraseStrokes, strokeHit } from "./eraser.mjs";
import { commitEdit, undoEdit } from "./strokes.mjs";

const line = (id, y) => Object.freeze({ id, width: 3, color: "black", points: Object.freeze([
  Object.freeze({ x: 0, y }), Object.freeze({ x: 100, y }),
]) });

test("whole-stroke eraser handles taps, endpoints, dots and fast crossing gestures", () => {
  const current = line("one", 50);
  assert.equal(strokeHit(current, { x: 40, y: 50 }, { x: 40, y: 50 }), true);
  assert.equal(strokeHit(current, { x: 110, y: 50 }, { x: 110, y: 50 }), true);
  assert.equal(strokeHit(current, { x: 40, y: -100 }, { x: 40, y: 200 }), true);
  assert.equal(strokeHit(current, { x: 40, y: 65 }, { x: 40, y: 65 }), false);
  assert.equal(strokeHit({ width: 3, points: [{ x: -50, y: -50 }] }, { x: -50, y: -55 }, { x: -50, y: -55 }), true);
});

test("eraser follows displayed midpoint curves rather than the control polygon", () => {
  const current = Object.freeze({ width: 3, points: Object.freeze([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }].map(Object.freeze)) });
  assert.equal(strokeHit(current, { x: 100, y: 66.67 }, { x: 100, y: 66.67 }, 1), true);
  assert.equal(strokeHit(current, { x: 100, y: 100 }, { x: 100, y: 100 }, 1), false);
});

test("erase removes hit strokes without mutating survivors or deleted points", () => {
  const first = line("one", 10);
  const second = line("two", 90);
  const strokes = Object.freeze([first, second]);
  const before = JSON.stringify(strokes);
  assert.deepEqual(eraseStrokes(strokes, { x: 20, y: 10 }, { x: 20, y: 10 }), [second]);
  assert.equal(eraseStrokes(strokes, { x: -50, y: -50 }, { x: -40, y: -40 }), strokes);
  assert.equal(JSON.stringify(strokes), before);
});

test("one eraser drag is one undo action, including erasing everything; missed drags add nothing", () => {
  const first = line("one", 10);
  const second = line("two", 90);
  let history = commitEdit([], [], [first]);
  const before = [first, second];
  history = commitEdit(history, [first], before);
  const after = eraseStrokes(eraseStrokes(before, { x: 20, y: 10 }, { x: 20, y: 10 }), { x: 20, y: 90 }, { x: 20, y: 90 });
  history = commitEdit(history, before, after);
  assert.deepEqual(after, []);
  assert.equal(history.length, 3);
  assert.equal(commitEdit(history, after, after), history);
  let restored = undoEdit(history, after);
  assert.equal(restored.strokes, before);
  restored = undoEdit(restored.history, restored.strokes);
  assert.deepEqual(restored.strokes, [first]);
  restored = undoEdit(restored.history, restored.strokes);
  assert.deepEqual(restored.strokes, []);
  assert.deepEqual(undoEdit([], []), { history: [], strokes: [] });
});
