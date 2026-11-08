// These operations never mutate completed strokes or their world-space points.
export function appendStroke(strokes, stroke) {
  return stroke.points.length ? [...strokes, stroke] : strokes;
}

export function undoStroke(strokes) {
  return strokes.length ? strokes.slice(0, -1) : strokes;
}

export function clearStrokes(strokes) {
  return strokes.length ? [] : strokes;
}

// Each completed pen stroke or eraser drag is one undoable edit.
// Snapshots share immutable completed stroke objects; no bitmap history is stored.
export function commitEdit(history, before, after) {
  return before === after ? history : [...history, before];
}

export function undoEdit(history, strokes) {
  return history.length
    ? { history: history.slice(0, -1), strokes: history.at(-1) }
    : { history, strokes };
}
