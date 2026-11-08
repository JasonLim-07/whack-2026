import { handleReview } from "../../../lib/ai/review.js";
import { recogniseHandwriting } from "../../../lib/ai/reviewOcr.js";

export const runtime = "nodejs";

export async function POST(request) {
  return handleReview(request, { recogniseHandwriting });
}
