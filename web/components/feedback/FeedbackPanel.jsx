"use client";

import { useState } from "react";
import { getConfirmedText } from "@/lib/review/client.mjs";
import { isLatinOnlyText } from "@/lib/review/text.mjs";
import { textHighlights } from "@/lib/review/locations.mjs";

const buttonClass = "rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

function TextVerification({ value, onEdit, onConfirm, controlIdPrefix }) {
  return (
    <section className="space-y-4" aria-label="Confirm your sentence">
      <p>Please confirm the text you intended.</p>
      <label className="block space-y-2" htmlFor={`${controlIdPrefix}confirmed-chinese-text`}>
        <span className="font-medium">What did you mean to write?</span>
        <textarea id={`${controlIdPrefix}confirmed-chinese-text`} lang="zh-Hans" rows={3} value={value} onChange={(event) => onEdit(event.target.value)}
          className="block w-full rounded-lg border border-neutral-300 p-3 text-lg leading-8 focus-visible:outline-2" />
      </label>
      {isLatinOnlyText(value) && <p>Please enter Chinese characters.</p>}
      <button type="button" disabled={!value.trim() || isLatinOnlyText(value)} onClick={onConfirm} className={buttonClass}>Confirm text and review</button>
    </section>
  );
}

function CharacterVerification({ review, selections, onSelectCharacter, onConfirm,
  intentDescriptions, intentSuggestions, onDescribe, onSuggest, controlIdPrefix }) {
  let preview = review.recognizedText;
  let complete = false;
  try { preview = getConfirmedText(review, selections, undefined, intentSuggestions); complete = true; }
  catch { /* Keep the literal transcription until every choice is confirmed. */ }
  return (
    <section aria-labelledby={`${controlIdPrefix}verify-text-heading`} className="space-y-4">
      <h3 id={`${controlIdPrefix}verify-text-heading`} className="font-medium text-neutral-800">What did you mean to write?</h3>
      {review.characterCandidates.length > 0 && <p className="text-neutral-600">Choose the character you intended. Suggestions can be wrong.</p>}
      {review.characterCandidates.map((candidate) => (
        <fieldset key={candidate.position} id={`${controlIdPrefix}character-choice-${candidate.position}`} tabIndex={-1} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <legend className="px-1 font-medium">Choose for <span lang="zh-Hans">{candidate.originalAttempt}</span></legend>
          {candidate.visuallyUncertain && <p className="mb-2 text-neutral-600">Check this character.</p>}
          <div className="flex flex-wrap gap-2">
            {candidate.options.map((option) => (
              <label key={option.char} className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 has-checked:border-neutral-800">
                <input type="radio" name={`${controlIdPrefix}character-${candidate.position}`} value={option.char}
                  checked={selections[candidate.position] === option.char}
                  onChange={() => onSelectCharacter(candidate.position, option.char)} className="accent-neutral-900" />
                <span lang="zh-Hans" className="text-xl">{option.char}</span>
                {option.char === candidate.originalAttempt && <span className="text-xs text-neutral-500">as written</span>}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {(review.intentTargets ?? []).map((target, index) => (
        <fieldset key={target.id} id={`${controlIdPrefix}intent-choice-${encodeURIComponent(target.id)}`} tabIndex={-1} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <legend className="px-1 font-medium">Unclear part {index + 1}{target.original && <>: <span lang="zh-Hans">{target.original}</span></>}</legend>
          <p lang="zh-Hans" className="break-words text-lg">{Array.from(review.recognizedText).slice(0, target.start).join("")}<mark>□</mark>{Array.from(review.recognizedText).slice(target.end).join("")}</p>
          <label className="block space-y-2">
            <span>Tell us what you meant in English</span>
            <input type="text" maxLength={300} value={intentDescriptions[target.id] ?? ""}
              placeholder="For example: a student" onChange={(event) => onDescribe(target.id, event.target.value)}
              className="block w-full rounded-md border border-neutral-300 bg-white p-2" />
          </label>
          <button type="button" disabled={!intentDescriptions[target.id]?.trim()} onClick={() => onSuggest(target.id)} className={buttonClass}>Suggest Chinese</button>
          {target.start === target.end && <label className="flex items-center gap-2">
            <input type="radio" name={`${controlIdPrefix}${target.id}`} checked={selections[target.id] === ""}
              onChange={() => onSelectCharacter(target.id, "")} className="accent-neutral-900" />
            This was just an extra mark
          </label>}
          {(intentSuggestions[target.id] ?? []).length > 0 && <p>Choose the meaning you intended:</p>}
          {(intentSuggestions[target.id] ?? []).map((suggestion) => (
            <label key={suggestion.text} className="flex cursor-pointer items-start gap-2 rounded-md border border-neutral-200 bg-white p-2">
              <input type="radio" name={`${controlIdPrefix}${target.id}`} checked={selections[target.id] === suggestion.text}
                onChange={() => onSelectCharacter(target.id, suggestion.text)} className="mt-2 accent-neutral-900" />
              <span><span lang="zh-Hans" className="block text-xl">{suggestion.text}</span><span>{suggestion.explanation}</span></span>
            </label>
          ))}
        </fieldset>
      ))}
      <div>
        <p className="mb-2 font-medium">Text to confirm</p>
        <p lang="zh-Hans" className="whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-3 text-lg leading-8">{preview || "…"}</p>
      </div>
      <button type="button" disabled={!complete} onClick={onConfirm} className={buttonClass}>Confirm text and review</button>
      {!complete && <p className="text-xs text-neutral-500">Choose an option for each unclear part to continue.</p>}
    </section>
  );
}

// Keep long provider explanations available without crowding the main feedback.
function previewExplanation(text) {
  if (text.length <= 160) return text;
  const sentence = text.match(/^.{1,160}?[.!?](?:\s|$)/u)?.[0];
  if (sentence) return sentence.trim();
  const prefix = text.slice(0, 157);
  return `${prefix.slice(0, prefix.lastIndexOf(" ") > 100 ? prefix.lastIndexOf(" ") : prefix.length)}…`;
}

export function WritingText({ text, issues = [], selectedIssueId, onSelectIssue }) {
  return <p lang="zh-Hans" className="whitespace-pre-wrap break-words text-2xl leading-relaxed text-neutral-900">
    {textHighlights(text, issues).map((run) => {
      const content = run.text.replaceAll("\uFFFC", "□");
      if (!run.issueIds.length) return <span key={run.key}>{content}</span>;
      const marked = <mark aria-label={run.insertion ? "Suggested insertion" : undefined}
        className={`rounded-sm ${run.issueIds.includes(selectedIssueId) ? "bg-blue-200 text-blue-950 ring-1 ring-blue-400" : "bg-blue-50 text-blue-950"}`}>{content}</mark>;
      return onSelectIssue ? <button key={run.key} type="button" onClick={() => onSelectIssue(run.issueIds[0])}
        aria-label="Show feedback for this character" className="rounded-sm focus-visible:outline-2">{marked}</button> : <span key={run.key}>{marked}</span>;
    })}
  </p>;
}

export function LearningTip({ tip }) {
  return tip ? <section aria-label="Your learning tip" className="rounded-xl bg-violet-50 px-4 py-3 text-violet-950">
    <h3 className="mb-1 text-xs font-semibold text-violet-700">Your learning tip</h3>
    <p role="note" className="text-sm leading-6">{tip}</p>
  </section> : null;
}

export function GrammarFeedback({ review, issues = review.issues, selectedIssueId, onSelectIssue,
  onDismiss, onAccept, accepted = false, heading = true }) {
  const [choice, setChoice] = useState(null);
  const active = issues.find((issue) => issue.id === selectedIssueId) ?? issues.find((issue) => issue.id === choice) ?? issues[0];
  const explanation = active ? previewExplanation(active.explanation) : "";
  return <section aria-label="Grammar feedback" className="space-y-3">
    {heading && <h3 className="text-sm font-medium text-neutral-500">Suggested correction</h3>}
    {review.issues.length === 0 ? <p role="status" className="text-sm text-emerald-800">Looks good — no grammar changes needed.</p> : <>
      <p lang="zh-Hans" className="whitespace-pre-wrap break-words rounded-xl bg-neutral-50 px-4 py-3 text-2xl leading-relaxed text-neutral-900">{review.correctedText}</p>
      {issues.length > 0 ? <>
        {issues.length > 1 && <p className="text-xs text-neutral-500">Choose a change to see why.</p>}
        <div className="flex flex-wrap gap-2" aria-label="Grammar suggestions">
          {issues.map((issue) => <button key={issue.id} type="button" aria-pressed={active?.id === issue.id}
            onClick={() => { setChoice(issue.id); onSelectIssue?.(issue.id); }}
            className={`rounded-lg px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${active?.id === issue.id ? "bg-blue-50 text-blue-900" : "bg-neutral-50 text-neutral-600 hover:bg-neutral-100"}`}>
            <span lang="zh-Hans">{issue.original || "＋"} <span aria-hidden="true">→</span> {issue.replacement || "Remove"}</span>
          </button>)}
        </div>
        <p className="text-sm leading-6 text-neutral-700">{explanation}</p>
      </> : <p className="text-sm text-neutral-500">Suggestions dismissed.</p>}
      {accepted && <p role="status" className="text-xs text-emerald-800">Digital correction applied. Your handwriting is unchanged.</p>}
      {((active && active.explanation !== explanation) || onDismiss || onAccept) && <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer focus-visible:outline-2">{active && active.explanation !== explanation ? "Explanation details" : "More options"}</summary>
        <div className="mt-2 space-y-2 leading-6">
          {active && active.explanation !== explanation && <p>{active.explanation}</p>}
          {onDismiss && active && <button type="button" onClick={() => onDismiss(active.id)} className="block underline underline-offset-2">Dismiss suggestion</button>}
          {onAccept && <button type="button" onClick={onAccept} className="block underline underline-offset-2">Use suggested text in digital correction view</button>}
        </div>
      </details>}
    </>}
  </section>;
}

export default function FeedbackPanel({ review, loading, error, onReview, stale = false, canReview = true,
  selections = {}, onSelectCharacter, onConfirm, confirmedText = "", onEditText, suggesting = false,
  intentDescriptions = {}, intentSuggestions = {}, onDescribe, onSuggest, selectedIssueId = null, onSelectIssue,
  reviewHighlights = [], controlIdPrefix = "", personalisedTip = null, onResetHistory, verificationOnly = false }) {
  const verifying = review?.requiresVerification === true;
  return <div className="space-y-5 text-sm leading-6" aria-busy={loading}>
    {error && !loading && <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-amber-950">
      <p>{error}</p>
      {!verifying && <button type="button" disabled={!canReview} onClick={onReview} className="text-xs underline disabled:opacity-40">Try again</button>}
    </div>}
    {!verificationOnly && <section aria-labelledby={`${controlIdPrefix}recognized-text-heading`} className="space-y-2">
      <h3 id={`${controlIdPrefix}recognized-text-heading`} className="text-sm font-medium text-neutral-500">Your writing</h3>
      {stale ? <p role="status" className="text-neutral-500">Writing changed. Review again to update feedback.</p>
        : review ? <WritingText text={review.recognizedText} issues={[...(review.issues ?? []), ...reviewHighlights]}
          selectedIssueId={selectedIssueId} onSelectIssue={onSelectIssue} />
          : !loading && !error && <p className="text-neutral-400">Write a Mandarin sentence to begin.</p>}
    </section>}
    {loading && <p role="status" className="text-sm text-neutral-500">{suggesting ? "Finding Chinese suggestions…" : "Analysing your writing…"}</p>}
    {!loading && !stale && review && (!error || verifying) && <>
      {verifying ? review.requiresTextConfirmation
        ? <TextVerification value={confirmedText} onEdit={onEditText} onConfirm={onConfirm} controlIdPrefix={controlIdPrefix} />
        : <CharacterVerification review={review} selections={selections} onSelectCharacter={onSelectCharacter} onConfirm={onConfirm}
          intentDescriptions={intentDescriptions} intentSuggestions={intentSuggestions} onDescribe={onDescribe} onSuggest={onSuggest} controlIdPrefix={controlIdPrefix} />
        : <><GrammarFeedback review={review} selectedIssueId={selectedIssueId} onSelectIssue={onSelectIssue} />
          <LearningTip tip={personalisedTip} /></>}
      {!verificationOnly && <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer focus-visible:outline-2">Review details</summary>
        <div className="mt-2 space-y-2">
          <p>{review.ocrConfidence == null ? "Recognition confidence unavailable." : `Recognition confidence: ${(review.ocrConfidence * 100).toFixed(1)}%`}</p>
          {!verifying && onResetHistory && <button type="button" onClick={onResetHistory} className="underline underline-offset-2">Reset learning history</button>}
        </div>
      </details>}
    </>}
  </div>;
}
