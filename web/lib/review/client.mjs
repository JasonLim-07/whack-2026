import { isLatinOnlyText, CHINESE_TEXT_MESSAGE } from "./text.mjs";
import { validTextRange, validOcrCharacters } from "./locations.mjs";

const INVALID_RESPONSE = "The review service returned an unexpected response. Please try again.";
const validConfidence = (value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);

export function validateReview(review, revision) {
  if (!review || typeof review.recognizedText !== "string" ||
    (!review.recognizedText.trim() && !(review.requiresVerification === true &&
      (review.requiresTextConfirmation === true || review.intentTargets?.length > 0))) ||
    !validConfidence(review.ocrConfidence ?? null) ||
    !Array.isArray(review.ocrSegments) || review.revision !== revision) {
    throw new Error(INVALID_RESPONSE);
  }
  for (const segment of review.ocrSegments) {
    if (!segment || typeof segment.text !== "string" || !validConfidence(segment.confidence)) throw new Error(INVALID_RESPONSE);
  }
  if (review.ocrCharacters !== undefined && !validOcrCharacters(review.ocrCharacters, review.recognizedText)) throw new Error(INVALID_RESPONSE);
  if (review.requiresVerification === true) {
    if (review.status !== "LOW_CONFIDENCE" || !Array.isArray(review.characterCandidates)) throw new Error(INVALID_RESPONSE);
    if (review.requiresTextConfirmation === true &&
      (typeof review.clarificationMessage !== "string" || !review.clarificationMessage.trim() ||
        !Array.isArray(review.unresolvedRegions) || review.unresolvedRegions.some((region) =>
          !region || typeof region.id !== "string" || !Number.isSafeInteger(region.row) || !Number.isSafeInteger(region.column)))) throw new Error(INVALID_RESPONSE);
    const characters = Array.from(review.recognizedText);
    if (review.intentTargets !== undefined && !Array.isArray(review.intentTargets)) throw new Error(INVALID_RESPONSE);
    const targetIds = new Set();
    let previousEnd = 0;
    for (const target of review.intentTargets ?? []) {
      if (!target || typeof target.id !== "string" || !target.id || targetIds.has(target.id) ||
        !Number.isInteger(target.start) || !Number.isInteger(target.end) || target.start < previousEnd ||
        target.end < target.start || target.end > characters.length ||
        target.original !== characters.slice(target.start, target.end).join("")) throw new Error(INVALID_RESPONSE);
      targetIds.add(target.id);
      previousEnd = target.end;
    }
    const positions = new Set();
    for (const candidate of review.characterCandidates) {
      if (!candidate || !Number.isInteger(candidate.position) || candidate.position < 0 ||
        candidate.position >= characters.length || positions.has(candidate.position) ||
        candidate.originalAttempt !== characters[candidate.position] ||
        (review.intentTargets ?? []).some((target) => candidate.position >= target.start && candidate.position < target.end) ||
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
  return review;
}

export function getConfirmedText(review, selections, editedText, intentSuggestions = {}) {
  validateReview(review, review.revision);
  if (review.requiresVerification !== true) throw new Error(INVALID_RESPONSE);
  if (review.requiresTextConfirmation === true) {
    if (typeof editedText !== "string" || !editedText.trim()) throw new Error("Enter the complete Chinese text you intended.");
    if (isLatinOnlyText(editedText)) throw new Error(CHINESE_TEXT_MESSAGE);
    return editedText;
  }
  const characters = Array.from(review.recognizedText);
  const edits = [];
  for (const candidate of review.characterCandidates) {
    const choice = selections[candidate.position];
    if (!candidate.options.some(({ char }) => char === choice)) {
      throw new Error("Choose an option for each uncertain character.");
    }
    edits.push({ start: candidate.position, end: candidate.position + 1, value: choice });
  }
  for (const target of review.intentTargets ?? []) {
    const choice = selections[target.id];
    if (!(target.start === target.end && choice === "") &&
      !intentSuggestions[target.id]?.some(({ text }) => text === choice)) {
      throw new Error("Choose a Chinese suggestion for each unclear part.");
    }
    edits.push({ start: target.start, end: target.end, value: choice });
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  const result = [];
  for (const edit of edits) {
    if (edit.start < cursor) throw new Error(INVALID_RESPONSE);
    result.push(characters.slice(cursor, edit.start).join(""), edit.value);
    cursor = edit.end;
  }
  result.push(characters.slice(cursor).join(""));
  return result.join("");
}

// Geometry stays local to the unchanged drawing revision. Only explicit edits
// can move its text offsets; arbitrary sentence edits cannot be aligned safely.
export function restoreConfirmedLocations(result, source, selections, editedText, intentSuggestions = {}) {
  if (!source || source.revision !== result.revision ||
    getConfirmedText(source, selections, editedText, intentSuggestions) !== result.recognizedText) return result;
  const original = source.ocrCharacters ?? [];
  if (!original.length || !validOcrCharacters(original, source.recognizedText)) return result;
  if (source.requiresTextConfirmation === true) {
    return source.recognizedText === result.recognizedText ? { ...result, ocrCharacters: original } : result;
  }
  const points = Array.from(source.recognizedText);
  const locations = points.map((text, index) => ({ text, bounds:
    original.find((entry) => entry.start === index && entry.end === index + 1)?.bounds ?? null }));
  const edits = [
    ...source.characterCandidates.map((candidate) => ({ start: candidate.position, end: candidate.position + 1, value: selections[candidate.position] })),
    ...(source.intentTargets ?? []).map((target) => ({ ...target, value: selections[target.id] })),
  ].sort((a, b) => b.start - a.start || b.end - a.end);
  for (const edit of edits) {
    const replacement = Array.from(edit.value);
    // A single replacement still describes the same written character. For
    // inserted or multi-character suggestions, keep geometry unavailable.
    const bounds = edit.end - edit.start === 1 && replacement.length === 1
      ? locations[edit.start].bounds : null;
    locations.splice(edit.start, edit.end - edit.start, ...replacement.map((text) => ({ text, bounds })));
  }
  const characters = locations.map((entry, start) => ({ ...entry, start, end: start + 1 }));
  return validOcrCharacters(characters, result.recognizedText) ? { ...result, ocrCharacters: characters } : result;
}

export function validateIntentResult(result, revision) {
  if (!result || result.revision !== revision || !Array.isArray(result.suggestions) ||
    result.suggestions.length < 1 || result.suggestions.length > 3) throw new Error(INVALID_RESPONSE);
  const seen = new Set();
  for (const suggestion of result.suggestions) {
    if (!suggestion || typeof suggestion.text !== "string" || !/\p{Script=Han}/u.test(suggestion.text) ||
      /\p{Script=Latin}/u.test(suggestion.text) || Array.from(suggestion.text).length > 24 ||
      seen.has(suggestion.text) || typeof suggestion.explanation !== "string" || !suggestion.explanation.trim()) throw new Error(INVALID_RESPONSE);
    seen.add(suggestion.text);
  }
  return result;
}

export function requestIntentSuggestions(description, context, revision, signal, fetchImpl = fetch) {
  return sendReview(JSON.stringify({ description, context, revision }), { "Content-Type": "application/json" },
    revision, signal, fetchImpl, "/api/intent", validateIntentResult);
}

export async function requestReview(image, revision, signal, fetchImpl = fetch) {
  const form = new FormData();
  form.append("image", image.image ?? image, "inkling-handwriting.png");
  if (image.spatial !== undefined) form.append("spatial", JSON.stringify(image.spatial));
  form.append("level", "beginner");
  form.append("revision", String(revision));
  return sendReview(form, undefined, revision, signal, fetchImpl);
}

export async function requestConfirmedReview(text, revision, signal, fetchImpl = fetch) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Confirmed text must not be empty.");
  if (isLatinOnlyText(text)) throw new Error(CHINESE_TEXT_MESSAGE);
  return sendReview(JSON.stringify({ text, level: "beginner", revision }),
    { "Content-Type": "application/json" }, revision, signal, fetchImpl);
}

async function sendReview(body, headers, revision, signal, fetchImpl, endpoint = "/api/review", validate = validateReview) {
  let response;
  try {
    response = await fetchImpl(endpoint, { method: "POST", body, ...(headers ? { headers } : {}), signal });
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
  return validate(result, revision);
}

// A synchronous guard also covers PNG encoding, before React has rerendered.
// Cancelling detaches old callbacks even if a mocked or late response ignores abort.
export function createReviewRunner(send = requestReview, sendConfirmed = requestConfirmedReview, sendIntent = requestIntentSuggestions) {
  let active = null;
  return {
    async run({ exportImage, exportSnapshot, text, intent, context, revision, isCurrent, onStart, onSuccess, onError, onFinish }) {
      if (active) return false;
      const controller = new AbortController();
      active = controller;
      onStart();
      try {
        const confirming = text !== undefined;
        const snapshot = intent !== undefined || confirming ? null
          : exportSnapshot ? await exportSnapshot() : { image: await exportImage(), revision };
        if (snapshot && snapshot.revision !== revision) return false;
        if (active !== controller || !isCurrent(revision)) return false;
        const review = intent !== undefined
          ? await sendIntent(intent, context, revision, controller.signal)
          : confirming ? await sendConfirmed(text, revision, controller.signal)
            : await send(snapshot.spatial === undefined ? snapshot.image : snapshot, revision, controller.signal);
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
