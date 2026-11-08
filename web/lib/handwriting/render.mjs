import { screenToWorld } from "./viewport.mjs";

import { GRID_SIZE } from "./grid.mjs";
import { cellKey, warningOpacity } from "./boundaries.mjs";

export { GRID_SIZE } from "./grid.mjs";

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

export function renderWhiteboard(ctx, size, viewport, strokes, activeStroke, renderUnderInk) {
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
  renderUnderInk?.();
  for (const stroke of strokes) drawStroke(ctx, stroke);
  if (activeStroke) drawStroke(ctx, activeStroke);
}

// Advisory overlay only: separate from permanent ink, sharing its world transform.
export function renderBoundaryWarnings(ctx, size, viewport, cells, warnings, now) {
  ctx.save();
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.translate(viewport.offsetX, viewport.offsetY);
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.strokeStyle = "#d97706";
  ctx.fillStyle = "#d97706";
  ctx.lineWidth = 2 / viewport.zoom;
  ctx.lineJoin = "round";
  const outlines = new Map();
  for (const warning of warnings.values()) {
    const key = cellKey(warning.cell);
    const opacity = warningOpacity(warning.startedAt, now);
    if (!outlines.has(key) || outlines.get(key).opacity < opacity) outlines.set(key, { cell: warning.cell, opacity });
  }
  for (const { cell, opacity } of outlines.values()) {
    ctx.globalAlpha = opacity * 0.7;
    ctx.strokeRect(cell.column * GRID_SIZE, cell.row * GRID_SIZE, GRID_SIZE, GRID_SIZE);
  }
  ctx.globalAlpha = 0.8;
  const unit = 1 / viewport.zoom;
  for (const cell of cells) {
    const x = (cell.column + 1) * GRID_SIZE - 9 * unit;
    const y = cell.row * GRID_SIZE + 9 * unit;
    ctx.beginPath();
    ctx.moveTo(x, y - 4 * unit);
    ctx.lineTo(x + 4 * unit, y + 3 * unit);
    ctx.lineTo(x - 4 * unit, y + 3 * unit);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Transient grammar rectangles are drawn behind ink and never used by PNG export.
export function renderGrammarHighlights(ctx, size, viewport, highlights, selectedIssueId) {
  if (!highlights.length) return;
  ctx.save();
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.translate(viewport.offsetX, viewport.offsetY);
  ctx.scale(viewport.zoom, viewport.zoom);
  for (const highlight of highlights) {
    const selected = highlight.issueId === selectedIssueId;
    ctx.fillStyle = selected ? "rgba(59, 130, 246, 0.26)" : "rgba(59, 130, 246, 0.10)";
    ctx.fillRect(highlight.x - 2, highlight.y - 2, highlight.width + 4, highlight.height + 4);
    if (selected) {
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5 / viewport.zoom;
      ctx.strokeRect(highlight.x - 2, highlight.y - 2, highlight.width + 4, highlight.height + 4);
    }
  }
  ctx.restore();
}
