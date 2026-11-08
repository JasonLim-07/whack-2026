"use client";

const typeLabels = { grammar: "Grammar", word_choice: "Word choice", character: "Character usage" };

export default function FeedbackPanel({ review, loading, error, onReview, stale = false, canReview = true }) {
  return (
    <div className="space-y-6 text-sm leading-6" aria-busy={loading}>
      {loading ? (
        <div role="status" className="rounded-lg bg-neutral-50 p-4 text-neutral-600">
          Reviewing your handwriting… Recognition and grammar analysis may take a moment. You can still pan and zoom.
        </div>
      ) : error ? (
        <div role="alert" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <p>{error}</p>
          <button type="button" disabled={!canReview} onClick={onReview} className="rounded-md border border-amber-300 px-3 py-1 font-medium disabled:opacity-40">Try again</button>
        </div>
      ) : stale ? (
        <p role="status" className="text-neutral-600">Writing changed. Review again to update feedback.</p>
      ) : !review ? (
        <p className="text-neutral-500">Write a Mandarin sentence and review it to see feedback here.</p>
      ) : (
        <>
          <section aria-labelledby="recognized-text-heading">
            <h3 id="recognized-text-heading" className="mb-2 font-medium text-neutral-800">Recognised Text</h3>
            <p lang="zh-Hans" className="whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-3 text-lg leading-8">{review.recognizedText}</p>
            <p className="mt-2 text-xs text-neutral-500">
              {review.ocrConfidence === null ? "Confidence unavailable." : `OCR confidence: ${(review.ocrConfidence * 100).toFixed(1)}% (provider-reported).`}
            </p>
          </section>
          <section aria-labelledby="corrected-text-heading">
            <h3 id="corrected-text-heading" className="mb-2 font-medium text-neutral-800">Suggested Text</h3>
            <p lang="zh-Hans" className="whitespace-pre-wrap break-words rounded-lg border border-neutral-200 p-3 text-lg leading-8">{review.correctedText}</p>
          </section>
          <section aria-labelledby="suggestions-heading">
            <h3 id="suggestions-heading" className="mb-3 font-medium text-neutral-800">Grammar Suggestions</h3>
            {review.issues.length === 0 ? (
              <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-900">No clear grammar issues found in this review.</p>
            ) : (
              <ul className="space-y-3">
                {review.issues.map((issue) => (
                  <li key={issue.id} className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                    <p className="mb-2 text-xs font-medium text-blue-800">{typeLabels[issue.type]}</p>
                    <div className="mb-2 flex flex-wrap items-baseline gap-2 text-base">
                      <span lang="zh-Hans" className="break-all rounded bg-white px-1.5 text-neutral-600"><span className="sr-only">Original: </span>{issue.original || "(insertion)"}</span>
                      <span aria-hidden="true" className="text-neutral-400">→</span>
                      <span lang={issue.replacement ? "zh-Hans" : undefined} className="break-all font-medium text-blue-900"><span className="sr-only">Suggestion: </span>{issue.replacement || "Remove this text"}</span>
                    </div>
                    <p className="break-words text-neutral-700">{issue.explanation}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-xs text-neutral-500">Recognition can misread handwriting. Compare the transcription with your original writing.</p>
        </>
      )}
    </div>
  );
}
