import { exportBounds } from "./export.mjs";
import { cellAt, cellKey, crossesCell } from "./boundaries.mjs";

// Same immutable completed strokes and crop transform as the PNG export.
export function writingRegions(strokes) {
  const crop = exportBounds(strokes);
  const cells = new Map();
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    const cell = stroke.originCell ?? cellAt(stroke.points[0]);
    const id = cellKey(cell);
    const region = cells.get(id) ?? { id, ...cell, left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, ambiguous: false };
    for (const point of stroke.points) {
      const radius = stroke.width / 2;
      region.left = Math.min(region.left, point.x - radius);
      region.top = Math.min(region.top, point.y - radius);
      region.right = Math.max(region.right, point.x + radius);
      region.bottom = Math.max(region.bottom, point.y + radius);
      region.ambiguous ||= crossesCell(point, cell);
    }
    region.ambiguous ||= stroke.boundaryStatus === "crossed_boundary";
    cells.set(id, region);
  }
  if (cells.size > 200) throw new Error("Please review a shorter writing sample (up to 200 writing regions).");
  return {
    width: crop.width, height: crop.height,
    regions: [...cells.values()].sort((a, b) => a.row - b.row || a.column - b.column).map((region) => ({
      id: region.id, row: region.row, column: region.column, ambiguous: region.ambiguous,
      bounds: { x: region.left - crop.left, y: region.top - crop.top,
        width: region.right - region.left, height: region.bottom - region.top },
    })),
  };
}
