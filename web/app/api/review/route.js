import { handleReview } from "../../../lib/ai/review.js";

export const runtime = "nodejs";

export async function POST(request) {
  // After merging OCR: import recogniseHandwriting and pass it here.
  return handleReview(request);
}
