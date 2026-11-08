"use client";

import { useId, useImperativeHandle } from "react";
import { NOTICE_DURATION_MS, NOTICE_FADE_MS } from "@/lib/handwriting/guidance.mjs";
import WhiteboardToolbar from "./WhiteboardToolbar";
import useWhiteboard from "./useWhiteboard";

export default function HandwritingCanvas({ disabled = false, onChange, onEditStart, onEditEnd, grammarHighlights, selectedIssueId, ref }) {
  const helpId = useId();
  const { rootRef, canvasRef, ui, selectTool, setZoom, undo, clear, exportImage, exportReviewImage, exportSnapshot, returnToWriting } = useWhiteboard({ disabled, onChange, onEditStart, onEditEnd, grammarHighlights, selectedIssueId });
  useImperativeHandle(ref, () => ({ exportImage, exportReviewImage, exportSnapshot }), [exportImage, exportReviewImage, exportSnapshot]);
  const navigating = ui.tool === "hand" || ui.zoom < 1 || ui.space;
  const cursor = ui.panning ? "grabbing" : navigating ? "grab" : disabled ? "not-allowed" : ui.tool === "eraser" ? "cell" : "crosshair";

  return (
    <section ref={rootRef} aria-label="Handwriting whiteboard" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <WhiteboardToolbar disabled={disabled} ui={ui} onTool={selectTool} onZoom={setZoom} onReturnToWriting={returnToWriting} onUndo={undo} onClear={clear} />
      <div className="relative min-h-64 flex-1 overflow-hidden rounded-xl border border-neutral-200">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="Drawing canvas"
          aria-describedby={helpId}
          className="absolute inset-0 block h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500"
          style={{ cursor }}
        >
          Your browser needs Canvas support to use this whiteboard.
        </canvas>
        {ui.notice && (
          <div key={ui.notice.id} role="status" className="pointer-events-none absolute z-10 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950 shadow-sm"
            style={{ left: "var(--notice-left, 8px)", top: "var(--notice-top, 8px)", width: "min(260px, calc(100% - 16px))", animation: `inkling-notice ${NOTICE_DURATION_MS}ms linear forwards` }}>
            {ui.notice.message}
          </div>
        )}
      </div>
      <style>{`@keyframes inkling-notice { 0%,${100 * (1 - NOTICE_FADE_MS / NOTICE_DURATION_MS)}% { opacity: 1; } 100% { opacity: 0; } }`}</style>
      <p id={helpId} className="text-xs leading-5 text-neutral-500">
        <span role="status">{disabled ? "Editing is paused during review. " : ui.zoom < 1 ? "Zoom to 100% to write or erase. " : "100% is the recommended writing scale. "}</span>
        Hold Space to pan. Scroll to move; Ctrl/Cmd + scroll to zoom. Ctrl/Cmd + Z to undo.
        {" "}Eraser removes whole strokes. Amber markers flag strokes crossing their starting cell, not Mandarin mistakes. Writing stays in this tab only.
      </p>
    </section>
  );
}
