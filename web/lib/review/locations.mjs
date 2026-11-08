// All text locations use Unicode code points, not JavaScript UTF-16 code units.
// Ranges are [start, end) in the original, unmodified OCR transcription.
export function validTextRange(text, start, end, original) {
  const points = Array.from(text);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) &&
    start >= 0 && end >= start && end <= points.length &&
    points.slice(start, end).join("") === original;
}

export function validBounds(bounds) {
  return bounds === null || (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.x >= 0 && bounds.y >= 0 && bounds.width > 0 && bounds.height > 0);
}

export function validOcrCharacters(characters, text) {
  if (!Array.isArray(characters)) return false;
  if (!characters.length) return true; // Geometry may be unavailable.
  let cursor = 0;
  for (const character of characters) {
    if (!character || typeof character.text !== "string" || !character.text || character.start !== cursor ||
      !validTextRange(text, character.start, character.end, character.text) || !validBounds(character.bounds)) return false;
    cursor = character.end;
  }
  return cursor === Array.from(text).length;
}

export function handwritingHighlights(review, exportBounds) {
  if (!review || !exportBounds) return [];
  const characters = review.ocrCharacters || [];
  return review.issues.flatMap((issue) => {
    // An insertion has no existing ink to highlight.
    if (issue.start === issue.end) return [];
    return characters.filter((character) => character.bounds && character.start < issue.end && character.end > issue.start)
      .map((character) => ({
        issueId: issue.id,
        x: character.bounds.x + exportBounds.left,
        y: character.bounds.y + exportBounds.top,
        width: character.bounds.width,
        height: character.bounds.height,
      }));
  });
}

export function textHighlights(text, issues) {
  const points = Array.from(text);
  const runs = [];
  for (let index = 0; index <= points.length; index++) {
    const insertions = issues.filter((issue) => issue.start === index && issue.end === index);
    if (insertions.length) runs.push({ key: `insert-${index}`, text: "│", insertion: true, issueIds: insertions.map((issue) => issue.id) });
    if (index < points.length) runs.push({
      key: `char-${index}`, text: points[index], insertion: false,
      issueIds: issues.filter((issue) => issue.start <= index && issue.end > index).map((issue) => issue.id),
    });
  }
  return runs;
}
