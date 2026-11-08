"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import HandwritingCanvas from "@/components/handwriting/HandwritingCanvas";
import FeedbackPanel from "@/components/feedback/FeedbackPanel";
import { createReviewRunner, getConfirmedText } from "@/lib/review/client.mjs";

export default function WritingWorkspace() {
  const canvasRef = useRef(null);
  const panelHeadingRef = useRef(null);
  const drawingRef = useRef({ revision: 0, hasInk: false });
  const runnerRef = useRef(null);
  const reviewRef = useRef(null);
  const pendingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [selections, setSelections] = useState({});
  const [confirmedText, setConfirmedText] = useState("");
  const [intentDescriptions, setIntentDescriptions] = useState({});
  const [intentSuggestions, setIntentSuggestions] = useState({});
  const [suggesting, setSuggesting] = useState(false);
  // null uses responsive CSS: open on desktop, closed on smaller screens.
  const [panelOpen, setPanelOpen] = useState(null);

  useEffect(() => {
    const runner = createReviewRunner();
    runnerRef.current = runner;
    return () => { runner.cancel(); runnerRef.current = null; };
  }, []);

  useEffect(() => {
    if (panelOpen === true) panelHeadingRef.current?.focus({ preventScroll: true });
  }, [panelOpen]);

  const handleDrawingChange = useCallback((drawing) => {
    drawingRef.current = drawing;
    setHasInk(drawing.hasInk);
    if (reviewRef.current || pendingRef.current) setStale(true);
    runnerRef.current?.cancel();
    pendingRef.current = false;
    setLoading(false);
    reviewRef.current = null;
    setReview(null);
    setError(null);
    setSelections({});
    setConfirmedText("");
    setIntentDescriptions({});
    setIntentSuggestions({});
    setSuggesting(false);
  }, []);

  function handleReview(text) {
    if (!drawingRef.current.hasInk || !canvasRef.current) return;
    // Button clicks pass an event; only an explicit string confirms text.
    const confirming = typeof text === "string";
    const revision = drawingRef.current.revision;
    runnerRef.current?.run({
      revision,
      ...(confirming ? { text } : {}),
      exportImage: () => canvasRef.current.exportReviewImage(),
      isCurrent: (submittedRevision) => drawingRef.current.revision === submittedRevision,
      onStart() {
        setLoading(true);
        pendingRef.current = true;
        if (!confirming) {
          reviewRef.current = null;
          setReview(null);
          setSelections({});
          setConfirmedText("");
          setIntentDescriptions({});
          setIntentSuggestions({});
        }
        setError(null);
        setStale(false);
        setPanelOpen(true);
      },
      onSuccess(result) {
        reviewRef.current = result;
        setReview(result);
        setSelections({});
        setConfirmedText(result.recognizedText);
        setIntentDescriptions({});
        setIntentSuggestions({});
      },
      onError: setError,
      onFinish() { pendingRef.current = false; setLoading(false); },
    });
  }

  function handleConfirm() {
    const current = reviewRef.current;
    if (!current?.requiresVerification || current.revision !== drawingRef.current.revision) return;
    try { handleReview(getConfirmedText(current, selections, confirmedText, intentSuggestions)); }
    catch (confirmationError) { setError(confirmationError.message); }
  }

  function handleSuggest(id) {
    const current = reviewRef.current;
    const description = intentDescriptions[id];
    if (!current?.intentTargets?.some((target) => target.id === id) || !description?.trim() ||
      current.revision !== drawingRef.current.revision) return;
    const target = current.intentTargets.find((entry) => entry.id === id);
    const characters = Array.from(current.recognizedText);
    const context = `${characters.slice(0, target.start).join("")}[unclear]${characters.slice(target.end).join("")}`;
    runnerRef.current?.run({
      intent: description, context: context.slice(0, 2000), revision: current.revision,
      isCurrent: (revision) => revision === drawingRef.current.revision && reviewRef.current === current,
      onStart() {
        pendingRef.current = true;
        setLoading(true);
        setSuggesting(true);
        setError(null);
        setSelections((value) => ({ ...value, [id]: undefined }));
        setIntentSuggestions((value) => ({ ...value, [id]: [] }));
      },
      onSuccess(result) { setIntentSuggestions((value) => ({ ...value, [id]: result.suggestions })); },
      onError: setError,
      onFinish() { pendingRef.current = false; setLoading(false); setSuggesting(false); },
    });
  }

  function closePanel() {
    setPanelOpen(false);
    requestAnimationFrame(() => document.getElementById("open-writing-review")?.focus());
  }

  const panelVisibility = panelOpen === null ? "hidden lg:flex" : panelOpen ? "flex" : "hidden";
  const openerVisibility = panelOpen === null ? "lg:hidden" : panelOpen ? "hidden" : "";

  return (
    <main className="flex h-dvh min-h-[32rem] flex-col bg-white px-4 py-5 sm:px-8">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Inkling</h1>
          <p className="text-sm text-neutral-500">A little room to practise.</p>
        </div>
        <button
          type="button" onClick={handleReview} disabled={!hasInk || loading}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >{loading ? "Reviewing…" : "Review"}</button>
        <button
          id="open-writing-review" type="button" onClick={() => setPanelOpen(true)}
          aria-controls="writing-review-panel" aria-expanded={false}
          className={`${openerVisibility} rounded-lg border border-neutral-200 px-3 py-2 text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2`}
        >Open Writing Review</button>
      </header>
      <div className="flex min-h-0 flex-1 gap-6">
        {/* Keep the canvas mounted here across every panel/layout state. */}
        <HandwritingCanvas ref={canvasRef} disabled={loading} onChange={handleDrawingChange} />
        <aside
          id="writing-review-panel" aria-labelledby="writing-review-heading"
          className={`${panelVisibility} fixed inset-x-0 bottom-0 z-20 max-h-[60dvh] flex-col overflow-y-auto rounded-t-xl border border-neutral-200 bg-white p-5 shadow-lg lg:static lg:z-auto lg:max-h-none lg:w-[360px] lg:shrink-0 lg:rounded-xl lg:shadow-none`}
          onKeyDown={(event) => { if (event.key === "Escape") closePanel(); }}
        >
          <div className="mb-5 flex items-center justify-between gap-2">
            <h2 ref={panelHeadingRef} tabIndex={-1} id="writing-review-heading" className="text-base font-semibold">Writing Review</h2>
            <button type="button" onClick={closePanel} aria-label="Collapse Writing Review" className="rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2">Collapse</button>
          </div>
          <FeedbackPanel review={review} loading={loading} error={error} stale={stale} canReview={hasInk} onReview={handleReview}
            selections={selections} onSelectCharacter={(position, char) => setSelections((current) => ({ ...current, [position]: char }))}
            confirmedText={confirmedText} onEditText={setConfirmedText} suggesting={suggesting}
            intentDescriptions={intentDescriptions} intentSuggestions={intentSuggestions} onSuggest={handleSuggest}
            onDescribe={(id, value) => {
              setIntentDescriptions((current) => ({ ...current, [id]: value }));
              setIntentSuggestions((current) => ({ ...current, [id]: [] }));
              setSelections((current) => ({ ...current, [id]: undefined }));
            }}
            onConfirm={handleConfirm} />
        </aside>
      </div>
    </main>
  );
}
