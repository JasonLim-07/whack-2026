import { GRID_SIZE } from "./grid.mjs";

export const BOUNDARY_TOLERANCE_RATIO = 0.05;
export const WARNING_DURATION_MS = 800;

export function cellAt(point) {
  return { row: Math.floor(point.y / GRID_SIZE), column: Math.floor(point.x / GRID_SIZE) };
}

export function cellKey(cell) {
  return `${cell.row}:${cell.column}`;
}

// Point centreline detection; equality at the tolerance limit is permitted.
export function crossesCell(point, cell, toleranceRatio = BOUNDARY_TOLERANCE_RATIO) {
  const tolerance = GRID_SIZE * toleranceRatio;
  const left = cell.column * GRID_SIZE;
  const top = cell.row * GRID_SIZE;
  return point.x < left - tolerance || point.x > left + GRID_SIZE + tolerance ||
    point.y < top - tolerance || point.y > top + GRID_SIZE + tolerance;
}

// Mutate only active-stroke metadata, never its origin or its points.
// The true return value is the once-per-stroke significant-crossing event.
export function flagBoundaryCrossing(stroke, point, toleranceRatio = BOUNDARY_TOLERANCE_RATIO) {
  if (stroke.boundaryStatus === "crossed_boundary" || !crossesCell(point, stroke.originCell, toleranceRatio)) return false;
  stroke.boundaryStatus = "crossed_boundary";
  return true;
}

export function invalidCells(strokes, activeStroke) {
  const cells = new Map();
  for (const stroke of activeStroke ? [...strokes, activeStroke] : strokes) {
    if (stroke.boundaryStatus === "crossed_boundary") cells.set(cellKey(stroke.originCell), stroke.originCell);
  }
  return [...cells.values()];
}

export function warningOpacity(startedAt, now) {
  return Math.max(0, Math.min(1, 1 - (now - startedAt) / WARNING_DURATION_MS));
}

export function pruneWarnings(warnings, strokes, activeStroke, now) {
  const ids = new Set(strokes.map((stroke) => stroke.id));
  if (activeStroke) ids.add(activeStroke.id);
  for (const [id, warning] of warnings) {
    if (!ids.has(id) || warningOpacity(warning.startedAt, now) === 0) warnings.delete(id);
  }
}
