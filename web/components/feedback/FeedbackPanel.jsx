"use client";

import { getConfirmedText } from "@/lib/review/client.mjs";
import { isLatinOnlyText } from "@/lib/review/text.mjs";
import { textHighlights } from "@/lib/review/locations.mjs";

const typeLabels = { grammar: "Grammar", word_choice: "Word choice", character: "Character usage" };

const buttonClass = "rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

function TextVerification({ value, onEdit, onConfirm, controlIdPrefix }) {
  return (
    <section className="space-y-4" aria-label="Confirm your sentence">
      <p>We’re unsure of the order. Please check your sentence.</p>
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

export default function FeedbackPanel({ review, loading, error, onReview, stale = false, canReview = true,
  selections = {}, onSelectCharacter, onConfirm, confirmedText = "", onEditText, suggesting = false,
  intentDescriptions = {}, intentSuggestions = {}, onDescribe, onSuggest, selectedIssueId = null, onSelectIssue, reviewHighlights = [], controlIdPrefix = "" }) {
  const verifying = review?.requiresVerification === true;
  return (
    <div className="space-y-6 text-sm leading-6" aria-busy={loading}>
      {error && !loading && (
        <div role="alert" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <p>{error}</p>
          {!verifying && <button type="button" disabled={!canReview} onClick={onReview} className="rounded-md border border-amber-300 px-3 py-1 font-medium disabled:opacity-40">Try again</button>}
        </div>
      )}
      {loading ? (
        <div role="status" className="rounded-lg bg-neutral-50 p-4 text-neutral-600">
          {suggesting ? "Finding Chinese suggestions…" : verifying ? "Reviewing your confirmed text…" : "Reviewing your handwriting… Recognition and grammar analysis may take a moment."} You can keep writing. Changes cancel this review.
        </div>
      ) : error && !verifying ? null : stale ? (
        <p role="status" className="text-neutral-600">Writing changed. Review again to update feedback.</p>
      ) : !review ? (
        <p className="text-neutral-500">Write a Mandarin sentence and review it to see feedback here.</p>
      ) : (
        <>
          <section aria-labelledby={`${controlIdPrefix}recognized-text-heading`}>
            <h3 id={`${controlIdPrefix}recognized-text-heading`} className="mb-2 font-medium text-neutral-800">Recognised Text</h3>
            <p lang="zh-Hans" className="whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-3 text-lg leading-8">{textHighlights(review.recognizedText, [...(review.issues ?? []), ...reviewHighlights]).map((run) => run.issueIds.length ? (
              <mark key={run.key} aria-label={run.insertion ? "Suggested insertion" : undefined}
                className={`rounded-sm ${run.issueIds.includes(selectedIssueId) ? "bg-blue-200 text-blue-950 ring-1 ring-blue-400" : "bg-blue-100 text-blue-950"}`}>
                {run.text}
              </mark>
            ) : <span key={run.key}>{run.text}</span>)}</p>
            <p className="mt-2 text-xs text-neutral-500">
              {review.ocrConfidence == null ? "Confidence unavailable." : `OCR confidence: ${(review.ocrConfidence * 100).toFixed(1)}% (provider-reported).`}
            </p>
          </section>
          {verifying ? review.requiresTextConfirmation
            ? <TextVerification value={confirmedText} onEdit={onEditText} onConfirm={onConfirm} controlIdPrefix={controlIdPrefix} />
            : <CharacterVerification review={review} selections={selections} onSelectCharacter={onSelectCharacter} onConfirm={onConfirm}
              intentDescriptions={intentDescriptions} intentSuggestions={intentSuggestions} onDescribe={onDescribe} onSuggest={onSuggest} controlIdPrefix={controlIdPrefix} /> : <>
          <section aria-labelledby={`${controlIdPrefix}corrected-text-heading`}>
            <h3 id={`${controlIdPrefix}corrected-text-heading`} className="mb-2 font-medium text-neutral-800">Suggested Text</h3>
            <p lang="zh-Hans" className="whitespace-pre-wrap break-words rounded-lg border border-neutral-200 p-3 text-lg leading-8">{review.correctedText}</p>
          </section>
          <section aria-labelledby={`${controlIdPrefix}suggestions-heading`}>
            <h3 id={`${controlIdPrefix}suggestions-heading`} className="mb-3 font-medium text-neutral-800">Grammar Suggestions</h3>
            {review.issues.length === 0 ? (
              <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-900">No clear grammar issues found in this review.</p>
            ) : (
              <ul className="space-y-3">
                {review.issues.map((issue) => (
                  <li key={issue.id}>
                    <button type="button" onClick={() => onSelectIssue?.(issue.id)} aria-pressed={selectedIssueId === issue.id}
                      className={`w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${selectedIssueId === issue.id ? "border-blue-400 bg-blue-100/70" : "border-blue-100 bg-blue-50/50"}`}>
                    <span className="mb-2 block text-xs font-medium text-blue-800">{typeLabels[issue.type]}</span>
                    <span className="mb-2 flex flex-wrap items-baseline gap-2 text-base">
                      <span lang="zh-Hans" className="break-all rounded bg-white px-1.5 text-neutral-600"><span className="sr-only">Original: </span>{issue.original || "(insertion)"}</span>
                      <span aria-hidden="true" className="text-neutral-400">→</span>
                      <span lang={issue.replacement ? "zh-Hans" : undefined} className="break-all font-medium text-blue-900"><span className="sr-only">Suggestion: </span>{issue.replacement || "Remove this text"}</span>
                    </span>
                    <span className="block break-words text-neutral-700">{issue.explanation}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </>}
          <p className="text-xs text-neutral-500">Recognition can misread handwriting. Compare the transcription with your original writing.</p>
        </>
      )}
    </div>
  );
}
