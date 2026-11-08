"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import HandwritingCanvas from "@/components/handwriting/HandwritingCanvas";
import FeedbackPanel from "@/components/feedback/FeedbackPanel";
import { createLearnerMemory } from "@/lib/learning/memory.mjs";
import { handwritingHighlights } from "@/lib/review/locations.mjs";
import { createReviewRunner, getConfirmedText, restoreConfirmedLocations } from "@/lib/review/client.mjs";
import { emptyMistakeHistory, mistakeReducer, mistakeOverlays } from "@/lib/review/mistakes.mjs";
import MistakeNotifications, { MistakeWarnings } from "@/components/feedback/MistakeNotifications";
import IncrementalFeedback from "@/components/feedback/IncrementalFeedback";
import { createIncrementalChecker } from "@/lib/review/incrementalChecker.mjs";

export default function WritingWorkspace() {
  const canvasRef = useRef(null);
  const panelHeadingRef = useRef(null);
  const drawingRef = useRef({ revision: 0, hasInk: false });
  const runnerRef = useRef(null);
  const reviewRef = useRef(null);
  const pendingRef = useRef(false);
  const checkerRef = useRef(null);
  const [checking, setChecking] = useState(null);
  const checkerActions = useMemo(() => ({
    recogniseNow: () => checkerRef.current?.recogniseNow(),
    checkGrammar: () => checkerRef.current?.checkGrammar(),
    confirm: (...args) => checkerRef.current?.confirm(...args),
    dismiss: (key) => checkerRef.current?.dismiss(key),
    acceptSentence: (key) => checkerRef.current?.acceptSentence(key),
    retryRegion: (...args) => checkerRef.current?.retryRegion(...args),
  }), []);
  const editingRef = useRef(false);
  const learnerMemoryRef = useRef(null);
  const learnerSessionRef = useRef(null);
  const [personalisedTip, setPersonalisedTip] = useState(null);
  const [hasInk, setHasInk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [editing, setEditing] = useState(false);
  const [snapshotBounds, setSnapshotBounds] = useState(null);
  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const [history, dispatchHistory] = useReducer(mistakeReducer, undefined, emptyMistakeHistory);
  const [selectedMistakeId, setSelectedMistakeId] = useState(null);
  const selectedMistake = history.occurrences.find((entry) => entry.id === selectedMistakeId);
  const incrementalSelected = checking?.regions.some((region) => region.review === selectedMistake?.sourceReview);
  const historicalSelection = selectedMistake && (selectedMistake.sourceReview !== review || selectedMistake.changed || !selectedMistake.live);
  const highlights = useMemo(() => {
    const grammar = (checking?.sentences ?? []).flatMap((sentence) => sentence.status === "ready" ? sentence.result.issues.flatMap((issue) => {
      const id = `grammar:${sentence.fingerprint}:${issue.id}`;
      if (checking.dismissed.includes(id) || issue.start === issue.end) return [];
      return sentence.characters.filter((character) => character.bounds && character.start < issue.end && character.end > issue.start)
        .map((character) => ({ ...character.bounds, issueId: id }));
    }) : []);
    return [...handwritingHighlights(review, snapshotBounds), ...mistakeOverlays(history), ...grammar];
  }, [review, snapshotBounds, history, checking]);
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
    const checker = createIncrementalChecker({ onState: setChecking,
      onObservation: (result, snapshot, allStrokes) => dispatchHistory({ type: "review", review: result, snapshot, allStrokes }),
      onConfirmation: (current, choices, suggestions, text) => dispatchHistory({ type: "confirm", review: current, selections: choices, intentSuggestions: suggestions, confirmedText: text }),
    });
    checkerRef.current = checker;
    return () => { checker.dispose(); checkerRef.current = null; };
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
    setPersonalisedTip(null);
    setError(null);
    setSelections({});
    setConfirmedText("");
    setIntentDescriptions({});
    setIntentSuggestions({});
    setSuggesting(false);
  }, []);

  const handleEditStart = useCallback(() => {
    editingRef.current = true;
    setEditing(true);
    checkerRef.current?.setEditing(true);
    invalidateReview();
  }, [invalidateReview]);

  const handleEditEnd = useCallback(() => {
    editingRef.current = false;
    setEditing(false);
    checkerRef.current?.setEditing(false);
  }, []);

  const handleDrawingChange = useCallback((drawing) => {
    drawingRef.current = drawing;
    setHasInk(drawing.hasInk);
    dispatchHistory({ type: "drawing", strokes: drawing.strokes });
    checkerRef.current?.update(drawing);
    invalidateReview();
  }, [invalidateReview]);

  function handleReview(text) {
    // Button clicks pass an event; only a string confirms text.
    const confirming = typeof text === "string";
    const confirmationSource = confirming ? reviewRef.current : null;
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
        setPersonalisedTip(null);
        if (!confirming) {
          setSelectedMistakeId(null);
          setSnapshotBounds(null);
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
      onSuccess(result, snapshot) {
        if (snapshot) {
          setSnapshotBounds(snapshot.bounds);
          dispatchHistory({ type: "review", review: result, snapshot });
        }
        const locatedResult = confirming
          ? restoreConfirmedLocations(result, confirmationSource, selections, confirmedText, intentSuggestions)
          : result;
        reviewRef.current = locatedResult;
        setReview(locatedResult);
        if (locatedResult.requiresVerification !== true) {
          learnerMemoryRef.current ??= createLearnerMemory();
          learnerSessionRef.current ??= crypto.randomUUID();
          learnerMemoryRef.current.recordCompletedReview(locatedResult, { sessionId: learnerSessionRef.current, revision });
          setPersonalisedTip(learnerMemoryRef.current.getPersonalisedTip(locatedResult));
        }
        setSelections({});
        setConfirmedText(result.recognizedText);
        setIntentDescriptions({});
        setIntentSuggestions({});
      },
      onError: setError,
      onFinish: () => { pendingRef.current = false; setLoading(false); },
    });
  }

  function handleConfirm() {
    const current = reviewRef.current;
    if (!current?.requiresVerification || current.revision !== drawingRef.current.revision) return;
    if (editingRef.current || pendingRef.current) return;
    try {
      const text = getConfirmedText(current, selections, confirmedText, intentSuggestions);
      // Explicit intent is valid evidence even if the subsequent grammar call fails.
      dispatchHistory({ type: "confirm", review: current, selections, intentSuggestions });
      handleReview(text);
    }
    catch (confirmationError) { setError(confirmationError.message); }
  }

  function handleSuggest(id) {
    const current = reviewRef.current;
    const description = intentDescriptions[id];
    if (editingRef.current || !current?.intentTargets?.some((target) => target.id === id) || !description?.trim() ||
      current.revision !== drawingRef.current.revision) return;
    const target = current.intentTargets.find((entry) => entry.id === id);
    const characters = Array.from(current.recognizedText);
    const context = `${characters.slice(0, target.start).join("")}[unclear]${characters.slice(target.end).join("")}`;
    runnerRef.current?.run({
      intent: description, context: context.slice(0, 2000), revision: current.revision,
      isCurrent: (revision) => !editingRef.current && revision === drawingRef.current.revision && reviewRef.current === current,
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

  function navigateMistake(entry) {
    setSelectedMistakeId(entry.id);
    setSelectedIssueId(entry.id);
    setPanelOpen(true);
    if (entry.live && !entry.changed && entry.bounds) canvasRef.current?.focusBounds(entry.bounds);
    requestAnimationFrame(() => {
      const region = checkerRef.current?.getState().regions.find((item) => item.review === entry.sourceReview);
      if (region) {
        const control = typeof entry.choiceKey === "number" ? `character-choice-${entry.choiceKey}` : `intent-choice-${encodeURIComponent(entry.choiceKey)}`;
        const target = document.getElementById(`region-${region.id}-${control}`) ?? document.getElementById(`incremental-region-${region.id}`);
        target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "nearest" }); return;
      }
      const current = entry.sourceReview === reviewRef.current && entry.live && !entry.changed;
      const controlId = typeof entry.choiceKey === "number" ? `character-choice-${entry.choiceKey}` : `intent-choice-${encodeURIComponent(entry.choiceKey)}`;
      const target = document.getElementById(current ? controlId : "selected-character-correction");
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    });
  }

  function dismissRegion(region) {
    checkerRef.current?.dismiss(`region:${region.fingerprint}`);
    dispatchHistory({ type: "dismiss", review: region.review });
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
      <MistakeWarnings history={history} onNavigate={navigateMistake} onDismiss={(ids) => dispatchHistory({ type: "acknowledge", ids })} />
      <div className="flex min-h-0 flex-1 gap-6">
        {/* Keep the canvas mounted here across every panel/layout state. */}
        <HandwritingCanvas ref={canvasRef} onChange={handleDrawingChange} onEditStart={handleEditStart} onEditEnd={handleEditEnd} grammarHighlights={editing ? [] : highlights} selectedIssueId={selectedIssueId} />
        <aside
          id="writing-review-panel" aria-labelledby="writing-review-heading"
          className={`${panelVisibility} fixed inset-x-0 bottom-0 z-20 max-h-[60dvh] flex-col overflow-y-auto rounded-t-xl border border-neutral-200 bg-white p-5 shadow-lg lg:static lg:z-auto lg:max-h-none lg:w-[360px] lg:shrink-0 lg:rounded-xl lg:shadow-none`}
          onKeyDown={(event) => { if (event.key === "Escape") closePanel(); }}
        >
          <div className="mb-5 flex items-center justify-between gap-2">
            <h2 ref={panelHeadingRef} tabIndex={-1} id="writing-review-heading" className="text-base font-semibold">Your tutor</h2>
            <button type="button" onClick={closePanel} aria-label="Collapse Writing Review" className="rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2">Collapse</button>
          </div>
          <IncrementalFeedback state={checking} checker={checkerActions} editing={editing} selectedIssueId={selectedIssueId}
            onSelectIssue={setSelectedIssueId} onDismissRegion={dismissRegion} personalisedTip={personalisedTip}
            onResetHistory={() => { learnerMemoryRef.current?.resetLearningHistory(); setPersonalisedTip(null); }} />
          <div className="mt-5 space-y-4 border-t border-neutral-100 pt-4">
          <MistakeNotifications history={history} selectedId={selectedMistakeId} onNavigate={navigateMistake}
            onDismiss={(entry) => dispatchHistory({ type: "dismiss", id: entry.id })} />
          {selectedMistake && !incrementalSelected && <section id="selected-character-correction" tabIndex={-1} className="mb-4 space-y-2 rounded-lg border border-blue-200 p-3 text-sm focus-visible:outline-2">
            <h3 className="font-medium">Selected handwriting check</h3>
            <p lang="zh-Hans">{selectedMistake.recognized || "Unclear writing"}</p>
            {!selectedMistake.bounds && <p>Location unavailable. Use the character choices below.</p>}
            {historicalSelection ? <>
              <p>This is an earlier review. Review the current writing before confirming a correction.</p>
              <fieldset disabled className="opacity-70"><legend className="sr-only">Earlier correction choices</legend>
                <FeedbackPanel review={selectedMistake.sourceReview} loading={false} error={null} selections={{}} controlIdPrefix="history-"
                  intentDescriptions={{}} intentSuggestions={{}} onReview={() => {}} onConfirm={() => {}} />
              </fieldset>
              <button type="button" onClick={() => { setSelectedMistakeId(null); handleReview(); }} disabled={!hasInk || loading || editing}
                className="rounded border px-3 py-1 disabled:opacity-40">Review current writing</button>
            </> : <p>Choose the intended character below, then confirm the text.</p>}
          </section>}
          <details open={loading || !!error || !!review} className="text-xs text-neutral-500">
            <summary className="cursor-pointer focus-visible:outline-2">Manual review</summary>
            <div className="mt-3">
          <FeedbackPanel review={review} loading={loading} error={error} stale={stale} canReview={hasInk && !editing} onReview={handleReview}
            reviewHighlights={history.occurrences.filter((entry) => entry.sourceReview === review && entry.detected).map((entry) => ({ id: entry.id, start: entry.start, end: entry.end }))}
            selectedIssueId={selectedIssueId} onSelectIssue={setSelectedIssueId}
            onResetHistory={() => {
              learnerMemoryRef.current?.resetLearningHistory();
              setPersonalisedTip(null);
            }}
            selections={selections} onSelectCharacter={(position, char) => setSelections((current) => ({ ...current, [position]: char }))}
            confirmedText={confirmedText} onEditText={setConfirmedText} suggesting={suggesting}
            intentDescriptions={intentDescriptions} intentSuggestions={intentSuggestions} onSuggest={handleSuggest}
            onDescribe={(id, value) => {
              setIntentDescriptions((current) => ({ ...current, [id]: value }));
              setIntentSuggestions((current) => ({ ...current, [id]: [] }));
              setSelections((current) => ({ ...current, [id]: undefined }));
            }}
            onConfirm={handleConfirm} />
            </div>
          </details>
          </div>
        </aside>
      </div>
    </main>
  );
}
