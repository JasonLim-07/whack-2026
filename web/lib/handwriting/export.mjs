import { drawStroke } from "./render.mjs";

export const EXPORT_PADDING = 24;
export const MAX_EXPORT_SIDE = 4096;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Bounds include line thickness; no viewport state or pixel ratio participates.
export function exportBounds(strokes) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const stroke of strokes) {
    const radius = stroke.width / 2;
    for (const point of stroke.points) {
      left = Math.min(left, point.x - radius);
      top = Math.min(top, point.y - radius);
      right = Math.max(right, point.x + radius);
      bottom = Math.max(bottom, point.y + radius);
    }
  }
  if (!Number.isFinite(left)) throw new Error("Write a Mandarin sentence before requesting a review.");
  left = Math.floor(left - EXPORT_PADDING);
  top = Math.floor(top - EXPORT_PADDING);
  const width = Math.ceil(right + EXPORT_PADDING) - left;
  const height = Math.ceil(bottom + EXPORT_PADDING) - top;
  if (width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE) {
    throw new Error("Your writing is spread over too large an area to review. Keep a short writing sample closer together (maximum 4096 pixels per side).");
  }
  return { left, top, width, height };
}

export async function exportStrokes(strokes, createCanvas = () => document.createElement("canvas")) {
  const bounds = exportBounds(strokes);
  const canvas = createCanvas();
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not prepare the handwriting image. Please try again.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, bounds.width, bounds.height);
  ctx.translate(-bounds.left, -bounds.top);
  // Only ink is drawn here. Grid and boundary overlays never enter the image.
  for (const stroke of strokes) drawStroke(ctx, { ...stroke, color: "#171717" });
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Unable to export a PNG. Please try again.")), "image/png");
  });
  if (blob.type !== "image/png" || blob.size === 0) throw new Error("Unable to export a valid PNG. Please try again.");
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("The handwriting image exceeds 5 MB. Please review a smaller writing sample.");
  return blob;
}
