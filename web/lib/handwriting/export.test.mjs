import test from "node:test";
import assert from "node:assert/strict";
import { exportBounds, exportStrokes, MAX_IMAGE_BYTES } from "./export.mjs";

const ink = (points = [{ x: -10, y: -20 }, { x: 100, y: 50 }]) => ({
  id: "one", points, width: 3, color: "black", boundaryStatus: "crossed_boundary",
});

function mockCanvas(blob = new Blob(["png"], { type: "image/png" })) {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, key) => (...args) => calls.push([key, ...args]),
    set: (_, key, value) => { calls.push(["set", key, value]); return true; },
  });
  const canvas = { getContext: () => ctx, toBlob: (callback, type) => { calls.push(["toBlob", type]); callback(blob); } };
  return { canvas, calls };
}

test("export bounds include all ink, negative coordinates, thickness, and 24 units of padding", () => {
  assert.deepEqual(exportBounds([ink()]), { left: -36, top: -46, width: 162, height: 122 });
  assert.deepEqual(exportBounds([ink([{ x: 0, y: 0 }])]), { left: -26, top: -26, width: 52, height: 52 });
  const offscreen = ink([{ x: 800, y: -900 }]);
  const bounds = exportBounds([ink(), offscreen]);
  assert.ok(bounds.top <= -925 && bounds.left <= -35);
  assert.ok(bounds.left + bounds.width >= 825);
});

test("empty and excessively spread handwriting fail before canvas allocation", async () => {
  let allocated = false;
  const createCanvas = () => { allocated = true; throw new Error("Must not allocate"); };
  await assert.rejects(exportStrokes([], createCanvas), /Write a Mandarin sentence/);
  await assert.rejects(exportStrokes([ink([])], createCanvas), /Write a Mandarin sentence/);
  await assert.rejects(exportStrokes([ink([{ x: 0, y: 0 }, { x: 5000, y: 0 }])], createCanvas), /too large an area/);
  assert.equal(allocated, false);
});

test("export draws only black ink on white, including flagged strokes, without mutating data", async () => {
  const strokes = Object.freeze([Object.freeze({ ...ink(), points: Object.freeze(ink().points.map(Object.freeze)) })]);
  const before = JSON.stringify(strokes);
  const { canvas, calls } = mockCanvas();
  const blob = await exportStrokes(strokes, () => canvas);
  assert.equal(blob.type, "image/png");
  assert.equal(canvas.width, 162);
  assert.equal(canvas.height, 122);
  assert.deepEqual(calls[0], ["set", "fillStyle", "#ffffff"]);
  assert.deepEqual(calls[1], ["fillRect", 0, 0, 162, 122]);
  assert.deepEqual(calls[2], ["translate", 36, 46]);
  assert.ok(calls.some(([name, key, value]) => name === "set" && key === "strokeStyle" && value === "#171717"));
  assert.equal(calls.filter(([name]) => name === "stroke").length, 1);
  assert.equal(calls.some(([name]) => ["strokeRect", "scale", "setTransform"].includes(name)), false);
  assert.deepEqual(calls.at(-1), ["toBlob", "image/png"]);
  assert.equal(JSON.stringify(strokes), before);
});

test("export reports encoding, context, MIME and size errors", async () => {
  for (const blob of [null, new Blob([], { type: "image/png" }), new Blob(["jpeg"], { type: "image/jpeg" })]) {
    await assert.rejects(exportStrokes([ink()], () => mockCanvas(blob).canvas), /PNG/);
  }
  await assert.rejects(exportStrokes([ink()], () => ({ getContext: () => null })), /browser could not prepare/);
  const large = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/png" });
  await assert.rejects(exportStrokes([ink()], () => mockCanvas(large).canvas), /5 MB/);
});
