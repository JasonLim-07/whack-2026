import { screenToWorld } from "./viewport.mjs";

export const GRID_SIZE = 96;

export function visibleGrid(viewport, width, height) {
  const start = screenToWorld({ x: 0, y: 0 }, viewport);
  const end = screenToWorld({ x: width, y: height }, viewport);
  return {
    left: Math.floor(start.x / GRID_SIZE) * GRID_SIZE,
    top: Math.floor(start.y / GRID_SIZE) * GRID_SIZE,
    right: Math.ceil(end.x / GRID_SIZE) * GRID_SIZE,
    bottom: Math.ceil(end.y / GRID_SIZE) * GRID_SIZE,
  };
}

export function drawStroke(ctx, stroke) {
  const points = stroke.points;
  if (!points.length) return;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (points.length === 1) {
    ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const next = points[i + 1];
    ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export function renderWhiteboard(ctx, size, viewport, strokes, activeStroke) {
  const { width, height, dpr } = size;
  // Reset each frame: resizing the bitmap also resets Canvas 2D state.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.translate(viewport.offsetX, viewport.offsetY);
  ctx.scale(viewport.zoom, viewport.zoom);

  const bounds = visibleGrid(viewport, width, height);
  ctx.beginPath();
  for (let x = bounds.left; x <= bounds.right; x += GRID_SIZE) {
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, bounds.bottom);
  }
  for (let y = bounds.top; y <= bounds.bottom; y += GRID_SIZE) {
    ctx.moveTo(bounds.left, y);
    ctx.lineTo(bounds.right, y);
  }
  ctx.strokeStyle = "#e8e8e8";
  ctx.lineWidth = 1 / viewport.zoom;
  ctx.lineCap = "butt";
  ctx.stroke();
  for (const stroke of strokes) drawStroke(ctx, stroke);
  if (activeStroke) drawStroke(ctx, activeStroke);
}
