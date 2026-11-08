"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HandwritingCanvas from "@/components/handwriting/HandwritingCanvas";
import FeedbackPanel from "@/components/feedback/FeedbackPanel";
import { handwritingHighlights } from "@/lib/review/locations.mjs";
import { createReviewRunner, getConfirmedText } from "@/lib/review/client.mjs";

export default function WritingWorkspace() {
  const canvasRef = useRef(null);
  const panelHeadingRef = useRef(null);
  const drawingRef = useRef({ revision: 0, hasInk: false });
  const runnerRef = useRef(null);
  const reviewRef = useRef(null);
  const pendingRef = useRef(false);
  const editingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [editing, setEditing] = useState(false);
  const [snapshotBounds, setSnapshotBounds] = useState(null);
  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const highlights = useMemo(() => handwritingHighlights(review, snapshotBounds), [review, snapshotBounds]);
  const [selections, setSelections] = useState({});
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

  const invalidateReview = useCallback(() => {
    if (reviewRef.current || pendingRef.current) setStale(true);
    runnerRef.current?.cancel();
    pendingRef.current = false;
    reviewRef.current = null;
    setLoading(false);
    setReview(null);
    setSnapshotBounds(null);
    setSelectedIssueId(null);
    setError(null);
    setSelections({});
  }, []);

  const handleEditStart = useCallback(() => {
    editingRef.current = true;
    setEditing(true);
    invalidateReview();
  }, [invalidateReview]);

  const handleEditEnd = useCallback(() => {
    editingRef.current = false;
    setEditing(false);
  }, []);

  const handleDrawingChange = useCallback((drawing) => {
    drawingRef.current = drawing;
    setHasInk(drawing.hasInk);
    invalidateReview();
  }, [invalidateReview]);

  function handleReview(text) {
    // Button clicks pass an event; only a string confirms text.
    const confirming = typeof text === "string";
    if (!drawingRef.current.hasInk || !canvasRef.current || editingRef.current) return;
    const revision = drawingRef.current.revision;
    runnerRef.current?.run({
      revision,
      ...(confirming ? { text } : {}),
      exportSnapshot: () => canvasRef.current.exportSnapshot(),
      isCurrent: (submittedRevision) => !editingRef.current && drawingRef.current.revision === submittedRevision,
      onStart() {
        pendingRef.current = true;
        setLoading(true);
        setSelectedIssueId(null);
        if (!confirming) {
          setSnapshotBounds(null);
          reviewRef.current = null;
          setReview(null);
          setSelections({});
        }
        setError(null);
        setStale(false);
        setPanelOpen(true);
      },
      onSuccess(result, snapshot) {
        if (snapshot) setSnapshotBounds(snapshot.bounds);
        reviewRef.current = result;
        setReview(result);
        setSelections({});
      },
      onError: setError,
      onFinish: () => { pendingRef.current = false; setLoading(false); },
    });
  }

  function handleConfirm() {
    const current = reviewRef.current;
    if (!current?.requiresVerification || current.revision !== drawingRef.current.revision) return;
    try { handleReview(getConfirmedText(current, selections)); }
    catch (confirmationError) { setError(confirmationError.message); }
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
          type="button" onClick={handleReview} disabled={!hasInk || loading || editing}
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
        <HandwritingCanvas ref={canvasRef} onChange={handleDrawingChange} onEditStart={handleEditStart} onEditEnd={handleEditEnd} grammarHighlights={highlights} selectedIssueId={selectedIssueId} />
        <aside
          id="writing-review-panel" aria-labelledby="writing-review-heading"
          className={`${panelVisibility} fixed inset-x-0 bottom-0 z-20 max-h-[60dvh] flex-col overflow-y-auto rounded-t-xl border border-neutral-200 bg-white p-5 shadow-lg lg:static lg:z-auto lg:max-h-none lg:w-[360px] lg:shrink-0 lg:rounded-xl lg:shadow-none`}
          onKeyDown={(event) => { if (event.key === "Escape") closePanel(); }}
        >
          <div className="mb-5 flex items-center justify-between gap-2">
            <h2 ref={panelHeadingRef} tabIndex={-1} id="writing-review-heading" className="text-base font-semibold">Writing Review</h2>
            <button type="button" onClick={closePanel} aria-label="Collapse Writing Review" className="rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2">Collapse</button>
          </div>
          <FeedbackPanel review={review} loading={loading} error={error} stale={stale} canReview={hasInk && !editing} onReview={handleReview}
            selectedIssueId={selectedIssueId} onSelectIssue={setSelectedIssueId}
            selections={selections} onSelectCharacter={(position, char) => setSelections((current) => ({ ...current, [position]: char }))}
            onConfirm={handleConfirm} />
        </aside>
      </div>
    </main>
  );
}
