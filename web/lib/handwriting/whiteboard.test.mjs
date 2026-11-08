import test from "node:test";
import assert from "node:assert/strict";
import { clampZoom, screenToWorld, worldToScreen, wheelDelta, zoomAt } from "./viewport.mjs";
import { appendStroke, clearStrokes, undoStroke } from "./strokes.mjs";
import { drawStroke, renderWhiteboard, visibleGrid } from "./render.mjs";

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);
}

test("coordinate transforms round-trip at negative offsets and every supported scale", () => {
  for (const zoom of [0.25, 0.381, 0.75, 1]) {
    const viewport = { zoom, offsetX: -147.2, offsetY: 93.1 };
    const point = { x: -893.4, y: 372.8 };
    const result = screenToWorld(worldToScreen(point, viewport), viewport);
    close(result.x, point.x);
    close(result.y, point.y);
  }
});

test("zoom clamps and snaps to exactly the writing scale", () => {
  assert.equal(clampZoom(0), 0.25);
  assert.equal(clampZoom(2), 1);
  assert.equal(clampZoom(0.9995), 1);
  assert.equal(clampZoom(0.998), 0.998);
});

test("repeated zoom preserves the world point under its anchor and stroke data", () => {
  let viewport = { zoom: 1, offsetX: -100, offsetY: 80 };
  const anchor = { x: 435.2, y: 187.7 };
  const world = screenToWorld(anchor, viewport);
  const stroke = Object.freeze({ id: "one", points: Object.freeze([Object.freeze({ ...world })]) });
  const before = JSON.stringify(stroke);
  for (let i = 0; i < 100; i++) {
    for (const zoom of [0.25, 0.456, 0.9999]) {
      viewport = zoomAt(viewport, zoom, anchor);
      const result = worldToScreen(world, viewport);
      close(result.x, anchor.x);
      close(result.y, anchor.y);
    }
  }
  assert.equal(viewport.zoom, 1);
  assert.equal(JSON.stringify(stroke), before);
});

test("grid bounds cover the visible area across positive and negative world coordinates", () => {
  for (const viewport of [
    { zoom: 1, offsetX: 25, offsetY: 50 },
    { zoom: 0.25, offsetX: -93, offsetY: -152 },
  ]) {
    const bounds = visibleGrid(viewport, 801, 603);
    const start = screenToWorld({ x: 0, y: 0 }, viewport);
    const end = screenToWorld({ x: 801, y: 603 }, viewport);
    assert.ok(bounds.left <= start.x && bounds.top <= start.y);
    assert.ok(bounds.right >= end.x && bounds.bottom >= end.y);
    for (const value of Object.values(bounds)) assert.equal(Math.abs(value % 96), 0);
  }
});

test("wheel normalises pixels, lines and pages", () => {
  assert.deepEqual(wheelDelta({ deltaMode: 0, deltaX: 2, deltaY: -3 }, 600), { x: 2, y: -3 });
  assert.deepEqual(wheelDelta({ deltaMode: 1, deltaX: 2, deltaY: -3 }, 600), { x: 32, y: -48 });
  assert.deepEqual(wheelDelta({ deltaMode: 2, deltaX: 1, deltaY: -1 }, 600), { x: 600, y: -600 });
});

test("undo removes completed strokes in order without mutating data; clear allows drawing again", () => {
  const first = Object.freeze({ id: "one", points: [{ x: 1, y: 2 }] });
  const second = Object.freeze({ id: "two", points: [{ x: 3, y: 4 }] });
  const original = Object.freeze([first, second]);
  assert.deepEqual(undoStroke(original), [first]);
  assert.deepEqual(undoStroke(undoStroke(original)), []);
  assert.equal(original.length, 2);
  assert.deepEqual(undoStroke([]), []);
  assert.deepEqual(appendStroke(clearStrokes(original), first), [first]);
  const empty = [];
  assert.equal(appendStroke(empty, { id: "empty", points: [] }), empty);
});

test("renderer draws dots and curved strokes without changing stored points", () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, key) => (...args) => calls.push([key, ...args]),
    set: () => true,
  });
  const points = Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 10, y: 12 }), Object.freeze({ x: 20, y: 0 })]);
  drawStroke(ctx, { color: "black", width: 3, points: [points[0]] });
  assert.ok(calls.some(([name]) => name === "arc"));
  assert.ok(calls.some(([name]) => name === "fill"));
  calls.length = 0;
  drawStroke(ctx, { color: "black", width: 3, points });
  assert.ok(calls.some(([name]) => name === "quadraticCurveTo"));
  assert.deepEqual(calls.at(-2), ["lineTo", 20, 0]);
  assert.deepEqual(calls.at(-1), ["stroke"]);
});


test("zoom anchoring survives clamping at either end", () => {
  const viewport = { zoom: 0.6, offsetX: -41, offsetY: 102 };
  const anchor = { x: 120, y: 90 };
  const world = screenToWorld(anchor, viewport);
  for (const requestedZoom of [0.01, 4]) {
    const next = zoomAt(viewport, requestedZoom, anchor);
    const screen = worldToScreen(world, next);
    close(screen.x, anchor.x);
    close(screen.y, anchor.y);
    assert.ok(next.zoom >= 0.25 && next.zoom <= 1);
  }
});

test("each render resets DPR before applying the shared grid/ink viewport", () => {
  const viewport = Object.freeze({ zoom: 0.5, offsetX: -31, offsetY: 47 });
  const stroke = Object.freeze({ color: "black", width: 3, points: Object.freeze([Object.freeze({ x: 15, y: 25 })]) });
  for (const dpr of [1, 2]) {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_, key) => (...args) => calls.push([key, ...args]),
      set: (_, key, value) => { calls.push(["set", key, value]); return true; },
    });
    renderWhiteboard(ctx, { width: 640, height: 480, dpr }, viewport, [stroke], null);
    assert.deepEqual(calls[0], ["setTransform", dpr, 0, 0, dpr, 0, 0]);
    assert.deepEqual(calls.find(([name]) => name === "translate"), ["translate", -31, 47]);
    assert.deepEqual(calls.find(([name]) => name === "scale"), ["scale", 0.5, 0.5]);
    assert.ok(calls.some(([name, key, value]) => name === "set" && key === "lineWidth" && value === 2));
    assert.deepEqual(calls.find(([name]) => name === "arc"), ["arc", 15, 25, 1.5, 0, Math.PI * 2]);
    assert.equal(calls.filter(([name]) => name === "setTransform").length, 1);
  }
});
