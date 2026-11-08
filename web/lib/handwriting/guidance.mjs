export const NOTICE_DURATION_MS = 1600;
export const NOTICE_FADE_MS = 400;

export function writingViewport(viewport, strokes, size) {
  const point = strokes.at(-1)?.points.at(-1);
  if (!point) {
    const centre = { x: size.width / 2, y: size.height / 2 };
    const world = { x: (centre.x - viewport.offsetX) / viewport.zoom, y: (centre.y - viewport.offsetY) / viewport.zoom };
    return { zoom: 1, offsetX: centre.x - world.x, offsetY: centre.y - world.y };
  }
  return { zoom: 1, offsetX: size.width / 2 - point.x, offsetY: size.height / 2 - point.y };
}
