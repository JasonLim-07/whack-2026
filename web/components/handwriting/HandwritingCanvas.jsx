"use client";

import { useId, useImperativeHandle } from "react";
import WhiteboardToolbar from "./WhiteboardToolbar";
import useWhiteboard from "./useWhiteboard";

export default function HandwritingCanvas({ disabled = false, onChange, ref }) {
  const helpId = useId();
  const { rootRef, canvasRef, ui, selectTool, setZoom, undo, clear, exportImage } = useWhiteboard({ disabled, onChange });
  useImperativeHandle(ref, () => ({ exportImage }), [exportImage]);
  const navigating = ui.tool === "hand" || ui.zoom < 1 || ui.space;
  const cursor = ui.panning ? "grabbing" : navigating ? "grab" : disabled ? "not-allowed" : ui.tool === "eraser" ? "cell" : "crosshair";

  return (
    <section ref={rootRef} aria-label="Handwriting whiteboard" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <WhiteboardToolbar disabled={disabled} ui={ui} onTool={selectTool} onZoom={setZoom} onUndo={undo} onClear={clear} />
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
      </div>
      <p id={helpId} className="text-xs leading-5 text-neutral-500">
        <span role="status">{disabled ? "Editing is paused during review. " : ui.zoom < 1 ? "Return to 100% to write or erase. " : "100% is the recommended writing scale. "}</span>
        Hold Space to pan. Scroll to move; Ctrl/Cmd + scroll to zoom. Ctrl/Cmd + Z to undo.
        {" "}Eraser removes whole strokes. Amber markers flag strokes crossing their starting cell, not Mandarin mistakes. Writing stays in this tab only.
      </p>
    </section>
  );
}
