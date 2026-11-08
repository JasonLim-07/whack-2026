export function validBounds(box, width = Infinity, height = Infinity) {
  return box && [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
    box.x + box.width <= width && box.y + box.height <= height;
}

export function validSpatialMetadata(value) {
  if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height) ||
    value.width < 1 || value.height < 1 || value.width > 4096 || value.height > 4096 ||
    !Array.isArray(value.regions) || value.regions.length < 1 || value.regions.length > 200) return false;
  const ids = new Set();
  return value.regions.every((region) => {
    if (!region || typeof region.id !== "string" || region.id.length > 80 || ids.has(region.id) ||
      !Number.isSafeInteger(region.row) || !Number.isSafeInteger(region.column) ||
      typeof region.ambiguous !== "boolean" || !validBounds(region.bounds, value.width, value.height)) return false;
    ids.add(region.id);
    return true;
  });
}

function overlaps(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  // Permit loose OCR boxes and thin handwriting; a grazing edge is not coverage.
  return width * height / Math.min(a.width * a.height, b.width * b.height) >= 0.15;
}

export function checkWritingCoverage(spatial, segments) {
  if (!spatial) return null;
  const boxes = segments.map((segment) => segment.bounds);
  const incompleteBoxes = boxes.some((box) => !validBounds(box)) || boxes.length === 0;
  const unresolvedRegions = spatial.regions.filter((region) =>
    !boxes.some((box) => validBounds(box) && overlaps(region.bounds, box)));
  const ordered = [...spatial.regions].sort((a, b) => a.row - b.row || a.column - b.column);
  const matches = boxes.map((box) => validBounds(box) ? ordered.flatMap((region, index) => overlaps(region.bounds, box) ? [index] : []) : []);
  let previous = -1;
  const uncertainOrder = matches.some((indices) => {
    if (indices.length !== 1 || indices[0] < previous) return true;
    previous = indices[0];
    return false;
  });
  const ambiguous = incompleteBoxes || spatial.regions.some((region) => region.ambiguous) ||
    uncertainOrder;
  if (!unresolvedRegions.length && !ambiguous) return null;
  // Empty OCR still has an unambiguous grid order unless strokes cross cells.
  const ambiguousOrdering = spatial.regions.some((region) => region.ambiguous) ||
    (segments.length > 0 && (incompleteBoxes || uncertainOrder));
  let offset = 0;
  const starts = segments.map((segment) => { const start = offset; offset += Array.from(segment.text).length; return start; });
  const intentTargets = ambiguousOrdering ? [] : ordered.filter((region) => unresolvedRegions.includes(region)).map((region) => {
    const rank = ordered.findIndex((entry) => entry.id === region.id);
    const next = matches.findIndex((indices) => indices[0] > rank);
    const start = next === -1 ? offset : starts[next];
    return { id: `missing:${region.id}`, start, end: start, original: "" };
  });
  return {
    unresolvedRegions,
    ambiguousOrdering, intentTargets,
    clarificationMessage: ambiguousOrdering
      ? "Please check the sentence and put the words in the order you intended."
      : "One part is unclear. Tell us what you meant in English.",
  };
}
