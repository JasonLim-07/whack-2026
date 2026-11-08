import { restoreConfirmedLocations, validateReview } from "./client.mjs";
import { GRID_SIZE } from "../handwriting/grid.mjs";

export function sentenceRanges(text, includeUnfinished = false) {
  const points = Array.from(text), sentences = [];
  let start = 0;
  for (let index = 0; index < points.length; index++) {
    const decimal = points[index] === "." && /\d/u.test(points[index - 1] ?? "") && /\d/u.test(points[index + 1] ?? "");
    if (!/[。！？.!?]/u.test(points[index]) || decimal) continue;
    while (index + 1 < points.length && /[。！？.!?]/u.test(points[index + 1])) index++;
    sentences.push({ text: points.slice(start, index + 1).join(""), start, end: index + 1, complete: true });
    start = index + 1;
  }
  if (start < points.length && points.slice(start).join("").trim()) sentences.push({ text: points.slice(start).join(""), start, end: points.length, complete: false });
  return includeUnfinished ? sentences : sentences.filter((sentence) => sentence.complete);
}

export function assembleTranscription(regions) {
  let cursor = 0;
  const characters = [], spans = [];
  for (const region of regions) {
    const text = region.text || "\uFFFC";
    const length = Array.from(text).length;
    spans.push({ start: cursor, end: cursor + length, regionId: region.id, fingerprint: region.fingerprint,
      uncertain: region.status !== "ready" || !region.confirmed });
    if (region.text) for (const character of region.characters ?? []) characters.push({ ...character, start: character.start + cursor, end: character.end + cursor });
    cursor += length;
  }
  return { text: regions.map((region) => region.text || "\uFFFC").join(""), characters, spans };
}

export function sentencesForRegions(regions) {
  const transcription = assembleTranscription(regions);
  return sentenceRanges(transcription.text, true).map((sentence) => {
    const spans = transcription.spans.filter((span) => span.start < sentence.end && span.end > sentence.start);
    return { ...sentence, uncertain: spans.some((span) => span.uncertain),
      fingerprint: JSON.stringify([sentence.text, spans.map((span) => [span.regionId, span.fingerprint, span.uncertain])]),
      characters: transcription.characters.filter((character) => character.start >= sentence.start && character.end <= sentence.end)
        .map((character) => ({ ...character, start: character.start - sentence.start, end: character.end - sentence.start })) };
  });
}

export function worldCharacters(review, bounds) {
  return (review.ocrCharacters ?? []).map((entry) => ({ ...entry, bounds: entry.bounds
    ? { ...entry.bounds, x: entry.bounds.x + bounds.left, y: entry.bounds.y + bounds.top } : null }));
}

export function confirmedRegion(region, text, selections, editedText, suggestions) {
  const result = restoreConfirmedLocations({ recognizedText: text, revision: region.review.revision, ocrCharacters: [] },
    region.review, selections, editedText, suggestions);
  return { ...region, text, characters: worldCharacters(result, region.snapshot.bounds), confirmed: true };
}

// Recognition success intentionally has no grammar output. Validate its OCR fields
// using the established review validator without presenting synthetic grammar feedback.
export function validateRecognition(result, revision) {
  if (!result || !["SUCCESS", "LOW_CONFIDENCE"].includes(result.status) || typeof result.requiresVerification !== "boolean" ||
    (result.status === "LOW_CONFIDENCE") !== result.requiresVerification || !Array.isArray(result.characterCandidates)) {
    throw new Error("The character checker returned an unexpected response. Please retry.");
  }
  validateReview(result?.requiresVerification ? result : { ...result, correctedText: result?.recognizedText, issues: [] }, revision);
  return result;
}

export function scopedContextResult(review, snapshot, target) {
  if (!target.context) return review;
  const edge = target.left * GRID_SIZE - snapshot.bounds.left;
  const all = review.ocrCharacters ?? [];
  const targetCharacters = all.filter((entry) => entry.bounds && entry.bounds.x + entry.bounds.width / 2 >= edge);
  const suffixStart = targetCharacters[0]?.start;
  const suffix = suffixStart !== undefined && targetCharacters.every((entry, index) => index === 0 || entry.start === targetCharacters[index - 1].end) &&
    targetCharacters.at(-1).end === Array.from(review.recognizedText).length;
  if (!suffix) return { ...review, requiresVerification: true, status: "LOW_CONFIDENCE", requiresTextConfirmation: true,
    characterCandidates: [], intentTargets: [], unresolvedRegions: [], ocrCharacters: [],
    clarificationMessage: "Enter only the text in the new or changed square; the preceding square was context." };
  const text = Array.from(review.recognizedText).slice(suffixStart).join("");
  let cursor = 0;
  const segments = review.ocrSegments.map((segment) => {
    const start = cursor; cursor += Array.from(segment.text).length;
    return { segment, start, end: cursor };
  }).filter((entry) => entry.start >= suffixStart).map((entry) => entry.segment);
  const candidates = (review.characterCandidates ?? []).filter((entry) => entry.position >= suffixStart).map((entry) => ({ ...entry, position: entry.position - suffixStart }));
  const targets = (review.intentTargets ?? []).filter((entry) => entry.start >= suffixStart).map((entry) => ({ ...entry, start: entry.start - suffixStart, end: entry.end - suffixStart }));
  const requiresVerification = candidates.length > 0 || targets.length > 0 || review.requiresTextConfirmation === true;
  return { ...review, recognizedText: text, ocrCharacters: targetCharacters.map((entry) => ({ ...entry, start: entry.start - suffixStart, end: entry.end - suffixStart })),
    ocrSegments: segments.map((segment) => segment.text).join("") === text ? segments : [],
    characterCandidates: candidates, intentTargets: targets, requiresVerification, status: requiresVerification ? "LOW_CONFIDENCE" : "SUCCESS" };
}
