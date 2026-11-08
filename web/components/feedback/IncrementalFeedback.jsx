"use client";

import { useEffect, useRef, useState } from "react";
import FeedbackPanel from "./FeedbackPanel";
import { requestIntentSuggestions } from "@/lib/review/client.mjs";

function RegionCorrection({ region, checker, onDismiss }) {
  const [selections, setSelections] = useState({});
  const [edited, setEdited] = useState(region.text);
  const [descriptions, setDescriptions] = useState({});
  const [suggestions, setSuggestions] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  async function suggest(id) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null);
    setSelections((value) => ({ ...value, [id]: undefined }));
    try {
      const result = await requestIntentSuggestions(descriptions[id], region.review.recognizedText.slice(0, 2000), region.review.revision, controller.signal);
      if (!controller.signal.aborted) setSuggestions((value) => ({ ...value, [id]: result.suggestions }));
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <div className="space-y-3">
    {region.review.characterCandidates?.some((entry) => entry.visuallyUncertain) &&
      <p className="text-sm text-amber-900">Handwriting advisory: this shape differs from a limited reference. This does not prove missing strokes or incorrect stroke order.</p>}
    {region.review.requiresTextConfirmation && <p className="text-sm text-neutral-700">{region.review.clarificationMessage}</p>}
    <FeedbackPanel review={region.review} loading={loading} suggesting={loading} error={error} selections={selections}
      onSelectCharacter={(id, char) => setSelections((value) => ({ ...value, [id]: char }))}
      confirmedText={edited} onEditText={setEdited} intentDescriptions={descriptions} intentSuggestions={suggestions}
      onDescribe={(id, value) => { setDescriptions((previous) => ({ ...previous, [id]: value })); setSuggestions((previous) => ({ ...previous, [id]: [] })); }}
      onSuggest={suggest} onReview={() => checker.recogniseNow()}
      controlIdPrefix={`region-${region.id}-`}
      onConfirm={() => {
        try { checker.confirm(region.id, region.fingerprint, selections, edited, suggestions); }
        catch (failure) { setError(failure.message); }
      }} />
    <button type="button" onClick={onDismiss} className="text-xs underline">Dismiss character suggestions</button>
    <button type="button" onClick={() => checker.retryRegion(region.id, region.fingerprint)} className="ml-3 text-xs underline">Retry recognition</button>
  </div>;
}

export default function IncrementalFeedback({ state, checker, editing, onSelectIssue, onDismissRegion }) {
  if (!state || !checker) return <p className="mb-4 text-sm text-neutral-500">Automatic character checking starts after you write.</p>;
  const dismissed = new Set(state.dismissed);
  return <section aria-label="Automatic Mandarin checkers" className="mb-5 space-y-5 border-b pb-5 text-sm">
    <section aria-label="Digital transcription">
      <h3 className="font-semibold">Digital transcription</h3>
      <p lang="zh-Hans" className="mt-2 whitespace-pre-wrap break-words rounded bg-neutral-50 p-3 text-lg">{state.transcription.text.replaceAll("\uFFFC", " [unread] ") || "Write in the grid to begin."}</p>
      {state.regions.some((region) => region.status === "ready" && !region.text) && <p role="status" className="mt-2 text-amber-900">Some writing could not be recognised. Enter the intended Chinese below or retry recognition.</p>}
      <p className="mt-2 text-xs text-neutral-500">Character checking starts after 1.5 seconds. Grammar waits for sentence punctuation and reliable or confirmed text.</p>
    </section>
    {editing ? <p role="status">Writing is changing. Affected results will be updated.</p> : <>
      <section aria-label="Character checker" className="space-y-3">
        <h3 className="font-semibold">Character checks</h3>
        {state.error && <p role="alert">{state.error}</p>}
        {!state.regions.length && <p>No handwriting to check.</p>}
        {state.regions.map((region) => <section key={region.fingerprint} id={`incremental-region-${region.id}`} tabIndex={-1} className="space-y-2 rounded border border-neutral-200 p-3 focus-visible:outline-2">
          <p className="font-medium">Writing region {region.top + 1}, {region.left + 1}</p>
          {region.status === "pending" || region.status === "loading" ? <p role="status">{region.status === "pending" ? "Waiting for a pause in writing…" : "Recognising this region…"}</p>
            : region.status === "error" ? <><p role="alert">{region.error}</p><button type="button" onClick={() => checker.recogniseNow()} className="underline">Retry character checking</button></>
              : region.confirmed ? <><p lang="zh-Hans" className="text-lg">{region.text}</p><p>{region.review.requiresVerification ? "Intended text confirmed." : "No supported character concerns detected."}</p></>
                : dismissed.has(`region:${region.fingerprint}`) ? <details><summary className="cursor-pointer">Dismissed suggestions — confirm transcription to enable grammar</summary>
                  <RegionCorrection region={region} checker={checker} onDismiss={() => onDismissRegion(region)} /></details>
                  : <RegionCorrection region={region} checker={checker} onDismiss={() => onDismissRegion(region)} />}
        </section>)}
        <p className="text-xs text-neutral-500">Stroke order is recorded. Stroke-order checking is not yet available.</p>
      </section>
      <section aria-label="Grammar checker" className="space-y-3">
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">GCSE grammar checks</h3>
          <button type="button" onClick={() => checker.checkGrammar()} disabled={!state.regions.length} className="rounded border px-3 py-1 disabled:opacity-40">Check grammar</button></div>
        {!state.sentences.length && <p>Complete a sentence, or use Check grammar without punctuation.</p>}
        {state.sentences.map((sentence) => <section key={sentence.fingerprint} className="space-y-2 rounded border p-3">
          <p lang="zh-Hans" className="text-lg">{sentence.text.replaceAll("\uFFFC", "□")}</p>
          {sentence.status === "blocked" ? <p>Confirm the uncertain handwriting in this sentence before grammar checking.</p>
            : sentence.status === "pending" ? <p>Waiting for sentence-ending punctuation, or Check grammar.</p>
              : sentence.status === "loading" ? <p role="status">Checking grammar…</p>
                : sentence.status === "error" ? <><p role="alert">{sentence.error}</p><button type="button" onClick={() => checker.checkGrammar()} className="underline">Retry grammar checking</button></>
                  : <>
                    {sentence.result.issues.length === 0 ? <p role="status">No clear grammar mistakes found.</p> : <>
                      <p>Suggested text: <span lang="zh-Hans">{sentence.result.correctedText}</span></p>
                      <ul className="space-y-2">{sentence.result.issues.map((issue) => {
                        const id = `grammar:${sentence.fingerprint}:${issue.id}`;
                        return dismissed.has(id) ? null : <li key={issue.id} className="space-y-2 rounded bg-blue-50 p-2">
                          <button type="button" onClick={() => onSelectIssue(id)} className="text-left font-medium underline"><span lang="zh-Hans">{issue.original || "Insertion"} → {issue.replacement || "Remove"}</span></button>
                          <p>{issue.explanation}</p>
                          <details><summary className="cursor-pointer">Explanation details</summary><p>Category: {issue.type === "character" ? "Character choice in context" : issue.type.replaceAll("_", " ")}. {issue.explanation} This concerns sentence usage, not physical stroke formation.</p></details>
                          <button type="button" onClick={() => checker.dismiss(id)} className="text-xs underline">Dismiss suggestion</button>
                        </li>;
                      })}</ul>
                      <button type="button" onClick={() => checker.acceptSentence(sentence.fingerprint)} className="underline">Use suggested text in digital correction view</button>
                    </>}
                    {sentence.accepted && <p lang="zh-Hans" className="rounded bg-emerald-50 p-2">Digital correction: {sentence.result.correctedText}</p>}
                  </>}
        </section>)}
      </section>
    </>}
  </section>;
}
