export const ERASER_RADIUS = 10;

function pointDistanceSquared(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0;
  return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2;
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsNear(a, b, c, d, radius) {
  // Proper intersections have zero distance even for long, fast eraser moves.
  if (orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0) return true;
  const limit = radius * radius;
  return Math.min(pointDistanceSquared(a, c, d), pointDistanceSquared(b, c, d),
    pointDistanceSquared(c, a, b), pointDistanceSquared(d, a, b)) <= limit;
}

// Approximate the same midpoint quadratic curves used by drawStroke.
// Subdivide until the control point is within 0.25 world units of its chord.
function curveHit(a, control, b, from, to, radius, depth = 0) {
  if (depth >= 12 || pointDistanceSquared(control, a, b) <= 0.25 ** 2) {
    return segmentsNear(from, to, a, b, radius + 0.25);
  }
  const ac = { x: (a.x + control.x) / 2, y: (a.y + control.y) / 2 };
  const cb = { x: (control.x + b.x) / 2, y: (control.y + b.y) / 2 };
  const middle = { x: (ac.x + cb.x) / 2, y: (ac.y + cb.y) / 2 };
  return curveHit(a, ac, middle, from, to, radius, depth + 1) || curveHit(middle, cb, b, from, to, radius, depth + 1);
}

export function strokeHit(stroke, from, to, radius = ERASER_RADIUS) {
  const { points } = stroke;
  if (!points.length) return false;
  const reach = radius + stroke.width / 2;
  let start = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i];
    const next = points[i + 1];
    const end = { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
    if (curveHit(start, control, end, from, to, reach)) return true;
    start = end;
  }
  return segmentsNear(from, to, start, points.at(-1), reach);
}

export function eraseStrokes(strokes, from, to, radius = ERASER_RADIUS) {
  const remaining = strokes.filter((stroke) => !strokeHit(stroke, from, to, radius));
  return remaining.length === strokes.length ? strokes : remaining;
}
