"use client";

import { useEffect, useRef, useState } from "react";
import FeedbackPanel, { GrammarFeedback, LearningTip, WritingText } from "./FeedbackPanel";
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
      <details className="text-xs text-neutral-500"><summary className="cursor-pointer">About this handwriting check</summary><p className="mt-2">This shape differs from a limited reference. This does not prove missing strokes or incorrect stroke order.</p></details>}
    <FeedbackPanel verificationOnly review={region.review} loading={loading} suggesting={loading} error={error} selections={selections}
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

export default function IncrementalFeedback({ state, checker, editing, selectedIssueId, onSelectIssue, onDismissRegion,
  personalisedTip, onResetHistory }) {
  if (!state || !checker) return <section className="space-y-2"><h3 className="text-sm font-medium text-neutral-500">Your writing</h3><p className="text-sm text-neutral-400">Write a Mandarin sentence to begin.</p></section>;
  const dismissed = new Set(state.dismissed);
  const unresolved = state.regions.filter((region) => !region.confirmed && !["pending", "loading"].includes(region.status));
  const analysing = editing || state.regions.some((region) => ["pending", "loading"].includes(region.status)) || state.sentences.some((sentence) => sentence.status === "loading");
  const ready = editing ? [] : state.sentences.filter((sentence) => sentence.status === "ready");
  const textIssues = ready.flatMap((sentence) => sentence.result.issues.flatMap((issue) => {
    const id = `grammar:${sentence.fingerprint}:${issue.id}`;
    return dismissed.has(id) ? [] : [{ ...issue, id, start: (sentence.start ?? 0) + issue.start, end: (sentence.start ?? 0) + issue.end }];
  }));
  return <div className="space-y-5 text-sm leading-6">
    <section aria-label="Your writing" className="space-y-2" aria-busy={analysing}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-neutral-500">Your writing</h3>
        {analysing && <span role="status" className="text-xs text-neutral-400">Analysing…</span>}
      </div>
      {state.transcription.text ? <WritingText text={state.transcription.text} issues={textIssues} selectedIssueId={selectedIssueId} onSelectIssue={onSelectIssue} />
        : <p className="text-neutral-400">Write a Mandarin sentence to begin.</p>}
      {state.error && <div role="alert"><p>{state.error}</p><button type="button" onClick={() => checker.recogniseNow()} className="text-xs underline">Retry character checking</button></div>}
    </section>
    {!editing && unresolved.length > 0 && <section aria-label="Character checks" className="space-y-4">
      <h3 className="font-medium text-amber-900">Check these characters</h3>
      {unresolved.map((region) => <section key={region.fingerprint} id={`incremental-region-${region.id}`} tabIndex={-1} className="focus-visible:outline-2">
        {region.status === "error" ? <div className="space-y-2 rounded-xl bg-amber-50 p-3">
          <p role="alert">{region.error}</p><button type="button" onClick={() => checker.recogniseNow()} className="text-xs underline">Retry character checking</button>
        </div> : <RegionCorrection region={region} checker={checker} onDismiss={() => onDismissRegion(region)} />}
        {dismissed.has(`region:${region.fingerprint}`) && <p className="mt-2 text-xs text-neutral-500">Confirm your intended text to continue.</p>}
      </section>)}
    </section>}
    {!editing && (state.regions.length > 0 || state.sentences.length > 0) && <section aria-label="Grammar feedback" className="space-y-3">
      <h3 className="text-sm font-medium text-neutral-500">Suggested correction</h3>
      {ready.map((sentence) => <GrammarFeedback key={sentence.fingerprint} review={sentence.result} heading={false}
        issues={sentence.result.issues.map((issue) => ({ ...issue, id: `grammar:${sentence.fingerprint}:${issue.id}` })).filter((issue) => !dismissed.has(issue.id))}
        selectedIssueId={selectedIssueId} onSelectIssue={onSelectIssue} onDismiss={(id) => checker.dismiss(id)}
        onAccept={() => checker.acceptSentence(sentence.fingerprint)} accepted={sentence.accepted} />)}
      {!ready.length && <p className="text-neutral-500">{state.sentences.some((sentence) => sentence.status === "blocked")
        ? "Confirm the characters above to continue." : analysing ? "Your feedback will appear here." : "Finish your sentence, or check grammar manually."}</p>}
      {state.sentences.filter((sentence) => sentence.status === "error").map((sentence) => <div key={sentence.fingerprint} role="alert" className="space-y-1">
        <p>{sentence.error}</p><button type="button" onClick={() => checker.checkGrammar()} className="text-xs underline">Retry grammar checking</button>
      </div>)}
    </section>}
    {!editing && <LearningTip tip={personalisedTip} />}
    {state.regions.length > 0 && <details className="text-xs text-neutral-500">
      <summary className="cursor-pointer focus-visible:outline-2">Review options</summary>
      <div className="mt-2 space-y-2">
        <button type="button" onClick={() => checker.checkGrammar()} disabled={editing} className="block underline underline-offset-2 disabled:opacity-40">Check grammar manually</button>
        <button type="button" onClick={() => checker.recogniseNow()} disabled={editing} className="block underline underline-offset-2 disabled:opacity-40">Retry recognition</button>
        {onResetHistory && <button type="button" onClick={onResetHistory} className="block underline underline-offset-2">Reset learning history</button>}
      </div>
    </details>}
  </div>;
}
