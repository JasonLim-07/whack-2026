import { suggestIntent } from "../../../lib/ai/intent.js";

export const runtime = "nodejs";

export async function POST(request) {
  const fail = (status, code, message) => Response.json({ error: { code, message } }, { status });
  if (!/^application\/json\s*(?:;|$)/i.test(request.headers.get("content-type") || "")) {
    return fail(400, "INVALID_REQUEST", "Please send an English description.");
  }
  let input;
  try {
    let size = 0;
    const chunks = [];
    if (Number(request.headers.get("content-length")) > 8192) return fail(413, "INTENT_TOO_LARGE", "Please use a shorter description.");
    if (!request.body) throw new Error("Empty body");
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > 8192) return fail(413, "INTENT_TOO_LARGE", "Please use a shorter description.");
      chunks.push(chunk);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return fail(400, "INVALID_REQUEST", "Please send a short English description."); }
  if (!input || typeof input.description !== "string" || !input.description.trim() || input.description.length > 300 ||
    (input.context !== undefined && (typeof input.context !== "string" || input.context.length > 2000)) ||
    !Number.isSafeInteger(input.revision) || input.revision < 0) {
    return fail(400, "INVALID_REQUEST", "Describe what you meant in a few English words.");
  }
  try {
    return Response.json({ ...await suggestIntent(input.description, input.context ?? ""), revision: input.revision });
  } catch (error) {
    return fail(error?.status === 429 ? 429 : 502, error?.status === 429 ? "RATE_LIMITED" : "INTENT_FAILED", error?.status === 429 ? "Too many requests. Please try again shortly." : "We couldn’t suggest Chinese right now. Please try again.");
  }
}
