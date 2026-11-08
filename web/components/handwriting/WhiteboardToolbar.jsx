const buttonClass = "rounded-md border border-neutral-200 px-3 py-2 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-600 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";

export default function WhiteboardToolbar({ ui, onTool, onZoom, onUndo, onClear }) {
  const percentage = ui.zoom === 1 ? "100%" : `${(ui.zoom * 100).toFixed(1)}%`;
  return (
    <div role="group" aria-label="Whiteboard controls" className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Drawing tools" className="flex gap-1">
        {["pen", "hand"].map((tool) => (
          <button
            key={tool}
            type="button"
            aria-pressed={ui.tool === tool}
            onClick={() => onTool(tool)}
            className={`${buttonClass} ${ui.tool === tool ? "bg-neutral-900 text-white hover:bg-neutral-800" : "bg-white text-neutral-700"}`}
          >
            {tool === "pen" ? "Pen" : "Hand"}
          </button>
        ))}
      </div>
      <button type="button" className={buttonClass} disabled={!ui.count} onClick={onUndo} title="Undo (Ctrl/Cmd+Z)">Undo</button>
      <button type="button" className={buttonClass} disabled={!ui.count} onClick={onClear}>Clear</button>
      <div className="ml-auto flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <span className="sr-only">Zoom</span>
          <input aria-label="Zoom" type="range" min="0.25" max="1" step="0.001" value={ui.zoom} onChange={(event) => onZoom(Number(event.target.value))} className="w-24 accent-neutral-800 sm:w-32" />
          <output className="w-14 text-right tabular-nums" aria-live="off">{percentage}</output>
        </label>
        <button type="button" className={buttonClass} onClick={() => onZoom(1)} title="Return to writing scale">100%</button>
      </div>
    </div>
  );
}
