import { GRID_SIZE } from "./grid.mjs";
import { strokeBounds } from "../review/mistakes.mjs";

function inkBounds(strokes) {
  const boxes = strokes.map(strokeBounds).filter(Boolean);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((box) => box.x)), y = Math.min(...boxes.map((box) => box.y));
  return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
}

function markType(stroke) {
  const points = stroke.points;
  if (!points.length) return null;
  const box = inkBounds([{ ...stroke, width: 0 }]);
  const size = Math.max(box.width, box.height);
  if (size <= 3) return ".";
  if (size > GRID_SIZE / 6 || Math.min(box.width, box.height) < 4 || box.width / box.height < 0.6 || box.width / box.height > 1.65) return null;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const length = points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
  if (points.length < 5 || distance(points[0], points.at(-1)) > Math.min(box.width, box.height) * 0.4 || length < size * 2.4 || length > size * 4.8) return null;
  return "。";
}

// Geometry recognises only a compact end-of-writing dot/ring. It is not an OCR
// confidence score and never treats an arbitrary small stroke as punctuation.
export function recogniseFullStop(group, regions, baseRegion = group.baseRegion) {
  if (group.ambiguous || !group.strokes.length) return null;
  const mark = group.strokes.at(-1), text = markType(mark), bounds = strokeBounds(mark);
  if (!text || !bounds || bounds.y < (group.top + 0.55) * GRID_SIZE) return null;
  if (group.strokes.length === 1) {
    const previous = regions.find((region) => region.right === group.left - 1 && region.top === group.top && region.bottom === group.bottom &&
      region.confirmed && /\p{Script=Han}$/u.test(region.text));
    const body = previous && inkBounds(previous.strokes);
    if (!body || bounds.y + bounds.height < body.y + body.height - GRID_SIZE * 0.16) return null;
    return { text, characters: [{ text, start: 0, end: 1, bounds }], segments: [{ text, confidence: null }] };
  }
  if (!baseRegion?.confirmed || !/^\p{Script=Han}+$/u.test(baseRegion.text)) return null;
  const bodyStrokes = group.strokes.slice(0, -1), body = inkBounds(bodyStrokes);
  if (!body || bounds.x < (group.left + 0.72) * GRID_SIZE || bounds.x < body.x + body.width + 6 ||
      bounds.y + bounds.height < body.y + body.height - GRID_SIZE * 0.12) return null;
  // A provider box that includes the mark is evidence it belongs to the glyph.
  if ((baseRegion.characters ?? []).some(({ bounds: box }) => box && bounds.x < box.x + box.width &&
      bounds.x + bounds.width > box.x && bounds.y < box.y + box.height && bounds.y + bounds.height > box.y)) return null;
  // Before recognition, the cached text must describe exactly the unchanged body.
  // After recognition it may describe the whole crop with its full stop omitted.
  if (baseRegion !== group && (baseRegion.strokes.length !== bodyStrokes.length || !bodyStrokes.every((stroke) => baseRegion.strokes.some((known) => known.id === stroke.id)))) return null;
  const start = Array.from(baseRegion.text).length;
  return { text: baseRegion.text + text, characters: [...(baseRegion.characters ?? []), { text, start, end: start + 1, bounds }],
    segments: [...(baseRegion.review?.ocrSegments ?? []), { text, confidence: null }] };
}
