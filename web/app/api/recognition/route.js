import { handleRecognition } from "../../../lib/ai/review.js";
import { recogniseRegion } from "../../../lib/ai/reviewOcr.js";

export const runtime = "nodejs";
export function POST(request) {
  return handleRecognition(request, { recogniseHandwriting: (buffer) => recogniseRegion(buffer, { signal: request.signal, recoverEmpty: true }) });
}
