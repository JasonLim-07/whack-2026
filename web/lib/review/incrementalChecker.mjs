import { incrementalRegions, recognitionContext, exportRecognitionRegion } from "../handwriting/incrementalRegions.mjs";
import { GRID_SIZE } from "../handwriting/grid.mjs";
import { exportBounds } from "../handwriting/export.mjs";
import { recogniseFullStop } from "../handwriting/punctuation.mjs";
import { validOcrCharacters } from "./locations.mjs";
import { assembleTranscription, sentencesForRegions, worldCharacters, confirmedRegion, scopedContextResult } from "./transcription.mjs";
import { getConfirmedText } from "./client.mjs";
import { requestRegion, requestGrammar } from "./incrementalClient.mjs";

export const CHARACTER_DEBOUNCE_MS = 1500;
const CACHE_LIMIT = 256;
function remember(cache, key, value) {
  cache.delete(key); cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

export function createIncrementalChecker({ recognise = requestRegion, grammar = requestGrammar,
  exportRegion = exportRecognitionRegion, onState = () => {}, onObservation = () => {}, onConfirmation = () => {},
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let regions = [], sentences = [], strokes = [], revision = 0, generation = 0, editing = false, disposed = false;
  let timer = null, recognitionController = null, groupError = null;
  const recognitionCache = new Map(), grammarCache = new Map(), grammarControllers = new Map(), dismissed = new Set();
  const state = () => ({ regions, sentences, revision, editing, error: groupError,
    transcription: assembleTranscription(regions), dismissed: [...dismissed] });
  const emit = () => { if (!disposed) onState(state()); };
  const stopRecognition = () => {
    generation++;
    if (timer !== null) unschedule(timer);
    timer = null; recognitionController?.abort(); recognitionController = null;
    regions = regions.map((region) => region.status === "loading" ? { ...region, status: "pending" } : region);
  };

  function snapshotMetadata(group, bounds, capturedRevision = revision) {
    return { bounds, revision: capturedRevision, strokes: group.strokes, scope: { id: group.id,
      bounds: { x: group.left * GRID_SIZE, y: group.top * GRID_SIZE,
        width: (group.right - group.left + 1) * GRID_SIZE, height: (group.bottom - group.top + 1) * GRID_SIZE } } };
  }

  function acceptPunctuation(group, punctuation, original = null) {
    const snapshot = snapshotMetadata(group, exportBounds(group.strokes));
    const cropCharacters = punctuation.characters.map((entry) => ({ ...entry, bounds: entry.bounds
      ? { ...entry.bounds, x: entry.bounds.x - snapshot.bounds.left, y: entry.bounds.y - snapshot.bounds.top } : null }));
    const review = { status: "SUCCESS", requiresVerification: false, characterCandidates: [], recognizedText: punctuation.text,
      ocrConfidence: null, ocrSegments: punctuation.segments, ocrCharacters: validOcrCharacters(cropCharacters, punctuation.text) ? cropCharacters : [],
      revision, recognitionSource: "stroke_geometry" };
    const next = { ...group, baseRegion: undefined, snapshot, review,
      rawReview: original?.rawReview ?? group.baseRegion?.rawReview ?? review, text: punctuation.text,
      characters: punctuation.characters, status: "ready", confirmed: true, error: null, recognitionSource: "stroke_geometry",
      confidenceProvenance: { overall: "unavailable", segments: "stroke-geometry; existing provider scores retained" } };
    remember(recognitionCache, group.fingerprint, next);
    regions = regions.map((entry) => entry.id === group.id ? next : entry);
    onObservation(review, snapshot, strokes);
  }

  function rebuildSentences() {
    const next = sentencesForRegions(regions).map((sentence) => {
      const previous = sentences.find((entry) => entry.fingerprint === sentence.fingerprint);
      return { ...sentence, status: sentence.uncertain ? "blocked" : previous?.status ?? "pending",
        result: previous?.result, error: previous?.error, accepted: previous?.accepted };
    });
    for (const [key, controller] of grammarControllers) if (!next.some((sentence) => sentence.fingerprint === key && !sentence.uncertain)) {
      controller.abort(); grammarControllers.delete(key);
    }
    sentences = next;
  }

  async function runGrammar(manual = false) {
    if (editing || disposed) return;
    for (const sentence of sentences) {
      if (!sentences.some((entry) => entry.fingerprint === sentence.fingerprint && !entry.uncertain)) continue;
      if (!/\p{Script=Han}/u.test(sentence.text) || sentence.uncertain || (!manual && !sentence.complete) || grammarControllers.has(sentence.fingerprint) ||
        sentence.status === "ready" || (!manual && sentence.status === "error")) continue;
      const fingerprint = sentence.fingerprint, text = sentence.text, cacheKey = JSON.stringify([text, "gcse"]);
      const controller = new AbortController();
      grammarControllers.set(fingerprint, controller);
      sentences = sentences.map((entry) => entry.fingerprint === fingerprint ? { ...entry, status: "loading", error: null } : entry);
      emit();
      try {
        const result = grammarCache.get(cacheKey) ?? await grammar(text, revision, controller.signal, "gcse");
        if (disposed || controller.signal.aborted || !sentences.some((entry) => entry.fingerprint === fingerprint && !entry.uncertain)) continue;
        remember(grammarCache, cacheKey, result);
        sentences = sentences.map((entry) => entry.fingerprint === fingerprint ? { ...entry, status: "ready", result } : entry);
      } catch (error) {
        if (!controller.signal.aborted && !disposed) sentences = sentences.map((entry) => entry.fingerprint === fingerprint
          ? { ...entry, status: "error", error: error.message || "Grammar checking failed. Please retry." } : entry);
      } finally {
        if (grammarControllers.get(fingerprint) === controller) grammarControllers.delete(fingerprint);
        emit();
      }
    }
  }

  async function recogniseDirty() {
    timer = null;
    if (editing || disposed) return;
    const ticket = generation;
    const controller = new AbortController(); recognitionController = controller;
    for (const group of regions) {
      if (ticket !== generation || editing || disposed) break;
      if (group.status !== "pending") continue;
      regions = regions.map((entry) => entry.id === group.id ? { ...entry, status: "loading", error: null } : entry);
      emit();
      try {
        const localPunctuation = recogniseFullStop(group, regions);
        if (localPunctuation) {
          acceptPunctuation(group, localPunctuation);
          rebuildSentences(); emit(); void runGrammar(); continue;
        }
        const contextual = recognitionContext(group, regions);
        const snapshot = await exportRegion(contextual, revision);
        if (ticket !== generation || controller.signal.aborted) break;
        const rawReview = await recognise(snapshot, controller.signal);
        if (ticket !== generation || controller.signal.aborted || disposed) break;
        let review = scopedContextResult(rawReview, snapshot, contextual);
        if (!review.recognizedText.trim()) review = { ...review, status: "LOW_CONFIDENCE", requiresVerification: true,
          requiresTextConfirmation: true, characterCandidates: [], intentTargets: [], unresolvedRegions: review.unresolvedRegions ?? [],
          clarificationMessage: "We could not read this square. Enter the Chinese text you intended, or retry recognition." };
        if (group.ambiguous) review = { ...review, requiresVerification: true, status: "LOW_CONFIDENCE", requiresTextConfirmation: true,
          characterCandidates: [], intentTargets: [], unresolvedRegions: [], clarificationMessage: "These strokes cross squares. Confirm the complete text in this region and its reading order." };
        const next = { ...group, baseRegion: undefined, snapshot: snapshotMetadata(group, snapshot.bounds, snapshot.revision), rawReview, review,
          confidenceProvenance: { overall: review.ocrConfidence == null ? "unavailable" : "provider-reported",
            segments: review.ocrSegments.some((segment) => segment.confidence !== null) ? "provider-reported" : "unavailable" },
          text: contextual.context && review.requiresTextConfirmation ? "" : review.recognizedText,
          characters: worldCharacters(review, snapshot.bounds), confirmed: !review.requiresVerification, status: "ready", error: null };
        const omittedPunctuation = recogniseFullStop(next, regions, next);
        if (omittedPunctuation) acceptPunctuation(next, omittedPunctuation, next);
        else {
          remember(recognitionCache, group.fingerprint, next);
          regions = regions.map((entry) => entry.id === group.id && entry.fingerprint === group.fingerprint ? next : entry);
          onObservation(review, next.snapshot, strokes);
        }
      } catch (error) {
        if (ticket !== generation || controller.signal.aborted || disposed) break;
        regions = regions.map((entry) => entry.id === group.id ? { ...entry, status: "error", error: error.message || "Recognition failed. Please retry." } : entry);
      }
      rebuildSentences(); emit(); void runGrammar();
    }
    if (recognitionController === controller) recognitionController = null;
  }

  return {
    getState: state,
    setEditing(value) {
      editing = value;
      if (value) stopRecognition();
      else if (regions.some((region) => region.status === "pending")) timer = schedule(recogniseDirty, CHARACTER_DEBOUNCE_MS);
      emit();
    },
    update(drawing) {
      stopRecognition(); strokes = drawing.strokes ?? []; revision = drawing.revision; groupError = null;
      try {
        regions = incrementalRegions(strokes).map((group) => {
          const previous = regions.find((entry) => entry.fingerprint === group.fingerprint);
          const cached = previous?.status === "ready" ? previous : recognitionCache.get(group.fingerprint);
          if (cached) {
            const restored = { ...cached, ...group };
            if (!previous) onObservation(restored.review, restored.snapshot, strokes);
            return restored;
          }
          return { ...group, baseRegion: regions.find((entry) => entry.id === group.id && entry.confirmed && entry.status === "ready"),
            status: "pending", text: "", characters: [], confirmed: false };
        });
      } catch (error) { regions = []; groupError = error.message; }
      rebuildSentences(); emit();
      if (!editing && regions.some((region) => region.status === "pending")) timer = schedule(recogniseDirty, CHARACTER_DEBOUNCE_MS);
      void runGrammar();
    },
    async recogniseNow() {
      stopRecognition();
      regions = regions.map((region) => region.status === "error" ? { ...region, status: "pending" } : region);
      return recogniseDirty();
    },
    confirm(id, fingerprint, selections, editedText, intentSuggestions = {}) {
      const region = regions.find((entry) => entry.id === id && entry.fingerprint === fingerprint);
      if (editing || !region?.review || region.status !== "ready") throw new Error("Writing changed. Please check the updated region first.");
      const text = getConfirmedText(region.review, selections, editedText, intentSuggestions);
      const next = confirmedRegion(region, text, selections, editedText, intentSuggestions);
      onConfirmation(region.review, selections, intentSuggestions, text);
      regions = regions.map((entry) => entry.id === id ? next : entry);
      remember(recognitionCache, fingerprint, next);
      for (const entry of regions) {
        if (entry.status !== "ready" || entry.confirmed) continue;
        const punctuation = recogniseFullStop(entry, regions);
        if (punctuation) acceptPunctuation(entry, punctuation, entry);
      }
      rebuildSentences(); emit(); void runGrammar();
    },
    checkGrammar: () => runGrammar(true),
    retryRegion(id, fingerprint) {
      if (editing || disposed) return;
      const region = regions.find((entry) => entry.id === id && entry.fingerprint === fingerprint);
      if (!region) return;
      stopRecognition(); recognitionCache.delete(fingerprint); dismissed.delete(`region:${fingerprint}`);
      regions = regions.map((entry) => entry.id === id ? { ...entry, status: "pending", text: "", characters: [], confirmed: false, error: null } : entry);
      rebuildSentences(); emit();
      return recogniseDirty();
    },
    dismiss(key) { dismissed.add(key); emit(); },
    acceptSentence(fingerprint) {
      sentences = sentences.map((entry) => entry.fingerprint === fingerprint && entry.result ? { ...entry, accepted: true } : entry); emit();
    },
    dispose() {
      disposed = true; stopRecognition();
      for (const controller of grammarControllers.values()) controller.abort();
      grammarControllers.clear(); recognitionCache.clear(); grammarCache.clear(); dismissed.clear();
    },
  };
}
