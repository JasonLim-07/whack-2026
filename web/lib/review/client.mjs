import { validTextRange, validOcrCharacters } from "./locations.mjs";

const INVALID_RESPONSE = "The review service returned an unexpected response. Please try again.";
const validConfidence = (value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);

export function validateReview(review, revision) {
  if (!review || typeof review.recognizedText !== "string" || !review.recognizedText.trim() ||
    !validConfidence(review.ocrConfidence ?? null) ||
    !Array.isArray(review.ocrSegments) || review.revision !== revision) {
    throw new Error(INVALID_RESPONSE);
  }
  for (const segment of review.ocrSegments) {
    if (!segment || typeof segment.text !== "string" || !validConfidence(segment.confidence)) throw new Error(INVALID_RESPONSE);
  }
  if (review.requiresVerification === true) {
    if (review.status !== "LOW_CONFIDENCE" || !Array.isArray(review.characterCandidates)) throw new Error(INVALID_RESPONSE);
    const characters = Array.from(review.recognizedText);
    const positions = new Set();
    for (const candidate of review.characterCandidates) {
      if (!candidate || !Number.isInteger(candidate.position) || candidate.position < 0 ||
        candidate.position >= characters.length || positions.has(candidate.position) ||
        candidate.originalAttempt !== characters[candidate.position] ||
        !validConfidence(candidate.confidence ?? null) || !Array.isArray(candidate.options) ||
        candidate.options.length < 2 || candidate.options.length > 3) throw new Error(INVALID_RESPONSE);
      const options = new Set();
      for (const option of candidate.options) {
        if (!option || typeof option.char !== "string" || Array.from(option.char).length !== 1 ||
          options.has(option.char) || typeof option.reason !== "string") throw new Error(INVALID_RESPONSE);
        options.add(option.char);
      }
      if (!options.has(candidate.originalAttempt)) throw new Error(INVALID_RESPONSE);
      positions.add(candidate.position);
    }
    return review;
  }
  if (review.status === "LOW_CONFIDENCE" || typeof review.correctedText !== "string" || !Array.isArray(review.issues)) {
    throw new Error(INVALID_RESPONSE);
  }
  const ids = new Set();
  for (const issue of review.issues) {
    if (!issue || typeof issue.id !== "string" || !issue.id || ids.has(issue.id) ||
      !["grammar", "word_choice", "character"].includes(issue.type) ||
      ![issue.original, issue.replacement, issue.explanation].every((value) => typeof value === "string")) {
      throw new Error(INVALID_RESPONSE);
    }
    if (!validTextRange(review.recognizedText, issue.start, issue.end, issue.original)) throw new Error(INVALID_RESPONSE);
    ids.add(issue.id);
  }
  if (review.ocrCharacters !== undefined && !validOcrCharacters(review.ocrCharacters, review.recognizedText)) throw new Error(INVALID_RESPONSE);
  return review;
}

export function getConfirmedText(review, selections) {
  validateReview(review, review.revision);
  if (review.requiresVerification !== true) throw new Error(INVALID_RESPONSE);
  const characters = Array.from(review.recognizedText);
  for (const candidate of review.characterCandidates) {
    const choice = selections[candidate.position];
    if (!candidate.options.some(({ char }) => char === choice)) {
      throw new Error("Choose an option for each uncertain character.");
    }
    characters[candidate.position] = choice;
  }
  return characters.join("");
}

export async function requestReview(image, revision, signal, fetchImpl = fetch) {
  const form = new FormData();
  form.append("image", image, "inkling-handwriting.png");
  form.append("level", "beginner");
  form.append("revision", String(revision));
  return sendReview(form, undefined, revision, signal, fetchImpl);
}

export async function requestConfirmedReview(text, revision, signal, fetchImpl = fetch) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Confirmed text must not be empty.");
  return sendReview(JSON.stringify({ text, level: "beginner", revision }),
    { "Content-Type": "application/json" }, revision, signal, fetchImpl);
}

async function sendReview(body, headers, revision, signal, fetchImpl) {
  let response;
  try {
    response = await fetchImpl("/api/review", { method: "POST", body, ...(headers ? { headers } : {}), signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Could not reach the review service. Check your connection and try again.");
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error(INVALID_RESPONSE); }
  if (!response.ok) {
    // The existing route returns sanitized, user-facing messages.
    const message = typeof result?.error?.message === "string" && result.error.message.trim()
      ? result.error.message : "Unable to review handwriting. Please try again.";
    throw new Error(message);
  }
  return validateReview(result, revision);
}

// A synchronous guard also covers PNG encoding, before React has rerendered.
// Cancelling detaches old callbacks even if a mocked or late response ignores abort.
export function createReviewRunner(send = requestReview, sendConfirmed = requestConfirmedReview) {
  let active = null;
  return {
    async run({ exportImage, exportSnapshot, text, revision, isCurrent, onStart, onSuccess, onError, onFinish }) {
      if (active) return false;
      const controller = new AbortController();
      active = controller;
      onStart();
      try {
        const confirming = text !== undefined;
        const snapshot = confirming ? null : exportSnapshot ? await exportSnapshot() : { image: await exportImage(), revision };
        if (snapshot && snapshot.revision !== revision) return false;
        if (active !== controller || !isCurrent(revision)) return false;
        const review = await (confirming ? sendConfirmed(text, revision, controller.signal) : send(snapshot.image, revision, controller.signal));
        if (active === controller && isCurrent(revision)) onSuccess(review, snapshot);
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
