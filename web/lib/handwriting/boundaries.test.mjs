import test from "node:test";
import assert from "node:assert/strict";
import { GRID_SIZE } from "./grid.mjs";
import { cellAt, crossesCell, flagBoundaryCrossing, invalidCells, pruneWarnings, warningOpacity } from "./boundaries.mjs";
import { screenToWorld, worldToScreen } from "./viewport.mjs";
import { appendStroke, clearStrokes, commitEdit, undoEdit } from "./strokes.mjs";
import { renderBoundaryWarnings } from "./render.mjs";

const stroke = (id = "one", point = { x: 48, y: 48 }) => ({
  id, points: [point], width: 3, color: "black", originCell: cellAt(point), boundaryStatus: "within_bounds",
});

test("cell ownership uses the existing grid and floor, including negative coordinates", () => {
  assert.equal(GRID_SIZE, 96);
  assert.deepEqual(cellAt({ x: 96, y: 192 }), { row: 2, column: 1 });
  assert.deepEqual(cellAt({ x: -0.1, y: -96.1 }), { row: -2, column: -1 });
  assert.deepEqual(cellAt({ x: -96, y: -192 }), { row: -2, column: -1 });
});

test("inside strokes, minor overshoots and equality at tolerance boundaries are allowed", () => {
  const cell = { row: 0, column: 0 };
  for (const point of [{ x: 0, y: 0 }, { x: 48, y: 48 }, { x: 96, y: 96 },
    { x: -9.6, y: 48 }, { x: 105.6, y: 48 }, { x: 48, y: -9.6 }, { x: 48, y: 105.6 },
    { x: 100, y: -4 }]) assert.equal(crossesCell(point, cell), false);
  assert.equal(crossesCell({ x: 97, y: 48 }, cell, 0), true);
  assert.equal(crossesCell({ x: 105, y: 48 }, cell, 0.1), false);
});

test("significant exits on every side and all diagonals, in positive and negative cells", () => {
  for (const cell of [{ row: 0, column: 0 }, { row: -2, column: -3 }]) {
    for (const [x, y] of [[-9.61,48], [105.61,48], [48,-9.61], [48,105.61],
      [-10,-10], [-10,106], [106,-10], [106,106]]) {
      assert.equal(crossesCell({ x: cell.column * GRID_SIZE + x, y: cell.row * GRID_SIZE + y }, cell), true);
    }
  }
});

test("one event per stroke; origin and every collected point remain unchanged after reentry", () => {
  const current = stroke();
  current.originCell = Object.freeze(current.originCell);
  current.points = Object.freeze([{ x: 48, y: 48 }, { x: 120, y: 48 }, { x: 48, y: 48 }, { x: -30, y: 200 }].map(Object.freeze));
  const before = JSON.stringify(current.points);
  let events = 0;
  for (const point of current.points) if (flagBoundaryCrossing(current, point)) events++;
  assert.equal(events, 1);
  assert.equal(current.boundaryStatus, "crossed_boundary");
  assert.deepEqual(current.originCell, { row: 0, column: 0 });
  assert.equal(JSON.stringify(current.points), before);
});

test("detection is independent of viewport position and scale", () => {
  const point = { x: -204, y: 305 };
  const origin = { row: 2, column: -2 };
  for (const viewport of [{ zoom: 1, offsetX: -800, offsetY: 53 }, { zoom: 0.25, offsetX: 172, offsetY: -123 }]) {
    const world = screenToWorld(worldToScreen(point, viewport), viewport);
    assert.equal(crossesCell(world, origin), crossesCell(point, origin));
    assert.deepEqual(cellAt(world), cellAt(point));
  }
});

test("markers aggregate by origin and reflect active strokes, undo, erasure, restoration, clear", () => {
  const first = stroke("one");
  const second = stroke("two");
  flagBoundaryCrossing(first, { x: 120, y: 48 });
  flagBoundaryCrossing(second, { x: 48, y: -20 });
  let strokes = [];
  let history = [];
  for (const current of [first, second]) {
    const next = appendStroke(strokes, current);
    history = commitEdit(history, strokes, next);
    strokes = next;
  }
  assert.equal(invalidCells(strokes).length, 1);
  assert.equal(invalidCells([], first).length, 1);
  assert.equal(invalidCells([]).length, 0);
  let restored = undoEdit(history, strokes);
  assert.equal(invalidCells(restored.strokes).length, 1);
  restored = undoEdit(restored.history, restored.strokes);
  assert.equal(invalidCells(restored.strokes).length, 0);
  history = commitEdit(history, strokes, []);
  assert.equal(invalidCells(undoEdit(history, []).strokes).length, 1);
  assert.equal(invalidCells(clearStrokes(strokes)).length, 0);
});

test("fade expires at 800ms; missing strokes lose their flashes immediately", () => {
  assert.equal(warningOpacity(100, 100), 1);
  assert.equal(warningOpacity(100, 500), 0.5);
  assert.equal(warningOpacity(100, 900), 0);
  assert.equal(warningOpacity(100, 1000), 0);
  const current = stroke();
  const warnings = new Map([[current.id, { cell: current.originCell, startedAt: 100 }]]);
  pruneWarnings(warnings, [], current, 200);
  assert.equal(warnings.size, 1);
  pruneWarnings(warnings, [current], null, 899);
  assert.equal(warnings.size, 1);
  pruneWarnings(warnings, [current], null, 900);
  assert.equal(warnings.size, 0);
  warnings.set(current.id, { cell: current.originCell, startedAt: 100 });
  pruneWarnings(warnings, [], null, 200);
  assert.equal(warnings.size, 0);
});

test("overlay shares DPR and viewport transforms, aggregates flashes and restores drawing state", () => {
  for (const zoom of [0.25, 1]) {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_, key) => (...args) => calls.push([key, ...args]),
      set: (_, key, value) => { calls.push(["set", key, value]); return true; },
    });
    const cell = { row: -2, column: 3 };
    const warnings = new Map([["one", { cell, startedAt: 100 }], ["two", { cell, startedAt: 300 }]]);
    renderBoundaryWarnings(ctx, { dpr: 2 }, { zoom, offsetX: 12, offsetY: -32 }, [cell], warnings, 500);
    assert.deepEqual(calls[0], ["save"]);
    assert.deepEqual(calls[1], ["setTransform", 2, 0, 0, 2, 0, 0]);
    assert.deepEqual(calls[2], ["translate", 12, -32]);
    assert.deepEqual(calls[3], ["scale", zoom, zoom]);
    assert.deepEqual(calls.filter(([key]) => key === "strokeRect"), [["strokeRect", 288, -192, 96, 96]]);
    assert.ok(calls.some(([name, key, value]) => name === "set" && key === "globalAlpha" && value === 0.75 * 0.7));
    assert.deepEqual(calls.at(-1), ["restore"]);
  }
});
