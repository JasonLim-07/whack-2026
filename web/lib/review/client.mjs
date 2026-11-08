const INVALID_RESPONSE = "The review service returned an unexpected response. Please try again.";
const validConfidence = (value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);

export function validateReview(review, revision) {
  if (!review || typeof review.recognizedText !== "string" || !review.recognizedText.trim() ||
    typeof review.correctedText !== "string" || !validConfidence(review.ocrConfidence) ||
    !Array.isArray(review.ocrSegments) || !Array.isArray(review.issues) || review.revision !== revision) {
    throw new Error(INVALID_RESPONSE);
  }
  for (const segment of review.ocrSegments) {
    if (!segment || typeof segment.text !== "string" || !validConfidence(segment.confidence)) throw new Error(INVALID_RESPONSE);
  }
  const ids = new Set();
  for (const issue of review.issues) {
    if (!issue || typeof issue.id !== "string" || !issue.id || ids.has(issue.id) ||
      !["grammar", "word_choice", "character"].includes(issue.type) ||
      ![issue.original, issue.replacement, issue.explanation].every((value) => typeof value === "string")) {
      throw new Error(INVALID_RESPONSE);
    }
    ids.add(issue.id);
  }
  return review;
}

export async function requestReview(image, revision, signal, fetchImpl = fetch) {
  const form = new FormData();
  form.append("image", image, "inkling-handwriting.png");
  form.append("level", "beginner");
  form.append("revision", String(revision));
  let response;
  try {
    response = await fetchImpl("/api/review", { method: "POST", body: form, signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Could not reach the review service. Check your connection and try again.");
  }
  let body;
  try { body = await response.json(); }
  catch { throw new Error(INVALID_RESPONSE); }
  if (!response.ok) {
    // The existing route returns sanitized, user-facing messages.
    const message = typeof body?.error?.message === "string" && body.error.message.trim()
      ? body.error.message : "Unable to review handwriting. Please try again.";
    throw new Error(message);
  }
  return validateReview(body, revision);
}

// A synchronous guard also covers PNG encoding, before React has rerendered.
// Cancelling detaches old callbacks even if a mocked or late response ignores abort.
export function createReviewRunner(send = requestReview) {
  let active = null;
  return {
    async run({ exportImage, revision, isCurrent, onStart, onSuccess, onError, onFinish }) {
      if (active) return false;
      const controller = new AbortController();
      active = controller;
      onStart();
      try {
        const image = await exportImage();
        if (active !== controller || !isCurrent(revision)) return false;
        const review = await send(image, revision, controller.signal);
        if (active === controller && isCurrent(revision)) onSuccess(review);
      } catch (error) {
        if (active === controller && error.name !== "AbortError" && isCurrent(revision)) onError(error.message || "Unable to review handwriting. Please try again.");
      } finally {
        if (active === controller) {
          active = null;
          onFinish();
        }
      }
      return true;
    },
    cancel() {
      const previous = active;
      active = null;
      previous?.abort();
    },
  };
}
