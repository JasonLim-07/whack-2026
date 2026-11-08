import { GRID_SIZE } from "./grid.mjs";
import { exportStrokeSnapshot } from "./export.mjs";
import { writingRegions } from "./regions.mjs";

export const strokeFingerprint = (strokes) => JSON.stringify(strokes.map(({ id, width, points }) => [id, width, points]));

// Occupied cell rectangles are merged only when strokes cross into each other.
// Separate, well-contained characters stay independently recognisable.
export function incrementalRegions(strokes) {
  let groups = strokes.filter((stroke) => stroke.points.length).map((stroke) => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const { x, y } of stroke.points) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    return { left: Math.floor(left / GRID_SIZE), right: Math.floor(right / GRID_SIZE),
      top: Math.floor(top / GRID_SIZE), bottom: Math.floor(bottom / GRID_SIZE), strokes: [stroke] };
  });
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
      const x = groups[a], y = groups[b];
      if (x.left <= y.right && y.left <= x.right && x.top <= y.bottom && y.top <= x.bottom) {
        groups[a] = { left: Math.min(x.left, y.left), right: Math.max(x.right, y.right), top: Math.min(x.top, y.top),
          bottom: Math.max(x.bottom, y.bottom), strokes: [...x.strokes, ...y.strokes] };
        groups.splice(b, 1); changed = true; break outer;
      }
    }
  }
  if (groups.length > 200) throw new Error("Please use up to 200 writing regions per sample.");
  const order = new Map(strokes.map((stroke, index) => [stroke.id, index]));
  groups = groups.sort((a, b) => a.top - b.top || a.left - b.left).map((group) => {
    const ordered = group.strokes.sort((a, b) => order.get(a.id) - order.get(b.id));
    return { ...group, id: `${group.top}:${group.left}:${group.bottom}:${group.right}`, strokes: ordered,
      fingerprint: strokeFingerprint(ordered), ambiguous: group.left !== group.right || group.top !== group.bottom };
  });
  return groups;
}

export async function exportRecognitionRegion(group, revision, createCanvas) {
  const snapshot = await exportStrokeSnapshot(group.strokes, revision, createCanvas);
  return { ...snapshot, strokes: group.strokes, spatial: writingRegions(group.strokes) };
}

export function isSmallRegion(group) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const stroke of group.strokes) for (const point of stroke.points) {
    left = Math.min(left, point.x); top = Math.min(top, point.y);
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
  }
  return Number.isFinite(left) && right - left < GRID_SIZE / 3 && bottom - top < GRID_SIZE / 3;
}

export function recognitionContext(group, groups) {
  // A tiny dot/mark often needs its preceding character to be recognised as punctuation.
  const previous = groups.find((entry) => entry.top === group.top && entry.bottom === group.bottom && entry.right === group.left - 1);
  if (!previous || !isSmallRegion(group)) return group;
  return { ...group, context: previous, strokes: [...previous.strokes, ...group.strokes] };
}
