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
