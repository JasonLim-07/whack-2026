import assert from "node:assert/strict";
import test from "node:test";
import { writingRegions } from "./regions.mjs";
import { exportBounds } from "./export.mjs";

const stroke = (x, y, dx = 40, dy = 50) => ({
  width: 3, points: [{ x, y }, { x: x + dx, y: y + dy }],
  originCell: { row: Math.floor(y / 96), column: Math.floor(x / 96) }, boundaryStatus: "within_bounds",
});

test("occupied regions share the exact PNG crop transform and preserve adjacent positions", () => {
  const strokes = [stroke(20, 20), stroke(116, 20), stroke(24, 24, 10, 15)];
  const before = JSON.stringify(strokes);
  const result = writingRegions(strokes);
  const crop = exportBounds(strokes);
  assert.equal(result.width, crop.width);
  assert.equal(result.height, crop.height);
  assert.equal(result.regions.length, 2);
  assert.equal(result.regions[1].bounds.x - result.regions[0].bounds.x, 96);
  assert.equal(result.regions[0].bounds.x, 20 - 1.5 - crop.left);
  assert.equal(result.regions[0].bounds.width, 43);
  assert.equal(JSON.stringify(strokes), before);
});

test("negative cells, punctuation dots and crossing strokes remain present without declaring missing characters", () => {
  const result = writingRegions([stroke(-70, -70), stroke(94, 20, 25, 10), stroke(140, 20, 0, 0)]);
  assert.equal(result.regions[0].row, -1);
  assert.equal(result.regions[0].column, -1);
  assert.equal(result.regions[1].ambiguous, true);
  assert.equal(result.regions[2].bounds.width, 3);
  assert.ok(result.regions.every(({ bounds }) => bounds.x >= 0 && bounds.y >= 0));
});

test("metadata is derived only from the current completed strokes after undo, erase or clear", () => {
  const first = stroke(20, 20);
  const second = stroke(116, 20);
  assert.equal(writingRegions([first, second]).regions.length, 2);
  assert.equal(writingRegions([first]).regions.length, 1);
  assert.throws(() => writingRegions([]), /Write a Mandarin/);
});
