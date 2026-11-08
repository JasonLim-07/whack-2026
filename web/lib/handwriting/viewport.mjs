export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1;

export function clampZoom(zoom) {
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  return MAX_ZOOM - clamped <= 0.001 ? MAX_ZOOM : clamped;
}

export function worldToScreen(point, viewport) {
  return {
    x: point.x * viewport.zoom + viewport.offsetX,
    y: point.y * viewport.zoom + viewport.offsetY,
  };
}

export function screenToWorld(point, viewport) {
  return {
    x: (point.x - viewport.offsetX) / viewport.zoom,
    y: (point.y - viewport.offsetY) / viewport.zoom,
  };
}

export function focusViewport(viewport, bounds, size) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return viewport;
  return { ...viewport,
    offsetX: size.width / 2 - (bounds.x + bounds.width / 2) * viewport.zoom,
    offsetY: size.height / 2 - (bounds.y + bounds.height / 2) * viewport.zoom };
}

export function zoomAt(viewport, requestedZoom, anchor) {
  const world = screenToWorld(anchor, viewport);
  const zoom = clampZoom(requestedZoom);
  return {
    zoom,
    offsetX: anchor.x - world.x * zoom,
    offsetY: anchor.y - world.y * zoom,
  };
}

export function wheelDelta(event, height) {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}
