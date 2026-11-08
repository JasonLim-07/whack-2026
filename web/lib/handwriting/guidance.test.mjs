import test from "node:test";
import assert from "node:assert/strict";
import { writingViewport, NOTICE_DURATION_MS, NOTICE_FADE_MS } from "./guidance.mjs";
import { worldToScreen, screenToWorld } from "./viewport.mjs";

const pointStroke = (x, y) => ({ points: [{ x, y }] });

test("100% centres the latest remaining ink without changing stored points", () => {
  const strokes = Object.freeze([pointStroke(-250, -100), pointStroke(875, 325)]);
  const before = JSON.stringify(strokes);
  const size = { width: 800, height: 500 };
  const viewport = { zoom: 0.25, offsetX: -700, offsetY: 200 };
  const next = writingViewport(viewport, strokes, size);
  assert.equal(next.zoom, 1);
  assert.deepEqual(worldToScreen(strokes.at(-1).points[0], next), { x: 400, y: 250 });
  const afterUndo = writingViewport(next, strokes.slice(0, -1), size);
  assert.deepEqual(worldToScreen(strokes[0].points[0], afterUndo), { x: 400, y: 250 });
  assert.equal(JSON.stringify(strokes), before);
});

test("without ink, 100% preserves the currently centred world point", () => {
  const viewport = { zoom: 0.41, offsetX: -117, offsetY: 89 };
  const size = { width: 777, height: 499 };
  const centre = { x: size.width / 2, y: size.height / 2 };
  const before = screenToWorld(centre, viewport);
  const after = screenToWorld(centre, writingViewport(viewport, [], size));
  assert.deepEqual(after, before);
});

test("guidance is brief, with its last 400ms reserved for fading", () => {
  assert.equal(NOTICE_DURATION_MS, 1600);
  assert.equal(NOTICE_FADE_MS, 400);
});
