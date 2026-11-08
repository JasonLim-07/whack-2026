"use client";

import { useEffect, useRef, useState } from "react";
import { screenToWorld, wheelDelta, zoomAt } from "@/lib/handwriting/viewport.mjs";
import { renderBoundaryWarnings, renderWhiteboard } from "@/lib/handwriting/render.mjs";
import { appendStroke, clearStrokes, commitEdit, undoEdit } from "@/lib/handwriting/strokes.mjs";

import { cellAt, flagBoundaryCrossing, invalidCells, pruneWarnings } from "@/lib/handwriting/boundaries.mjs";
import { eraseStrokes } from "@/lib/handwriting/eraser.mjs";

export default function useWhiteboard({ disabled, onChange }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const controllerRef = useRef(null);
  const optionsRef = useRef({ disabled, onChange });
  const strokesRef = useRef([]);
  const historyRef = useRef([]);
  const warningsRef = useRef(new Map());
  const viewportRef = useRef({ offsetX: 0, offsetY: 0, zoom: 1 });
  const gestureRef = useRef(null);
  const revisionRef = useRef(0);
  const [ui, setUi] = useState({ tool: "pen", zoom: 1, count: 0, canUndo: false, panning: false, space: false });

  useEffect(() => {
    optionsRef.current = { disabled, onChange };
    if (disabled) controllerRef.current?.cancel();
  }, [disabled, onChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    const ctx = canvas.getContext("2d");
    let size = { width: 0, height: 0, dpr: 1 };
    let tool = "pen";
    let space = false;
    let frame = null;
    let resolutionQuery;

    function redraw() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const activeStroke = gestureRef.current?.stroke;
        const now = performance.now();
        pruneWarnings(warningsRef.current, strokesRef.current, activeStroke, now);
        renderWhiteboard(ctx, size, viewportRef.current, strokesRef.current, activeStroke);
        renderBoundaryWarnings(ctx, size, viewportRef.current,
          invalidCells(strokesRef.current, activeStroke), warningsRef.current, now);
        // Continue only while a transient outline is fading, including its final clean frame.
        if (warningsRef.current.size) redraw();
      });
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      size = { width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 };
      const width = Math.max(1, Math.round(size.width * size.dpr));
      const height = Math.max(1, Math.round(size.height * size.dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      redraw();
    }

    function watchResolution() {
      resolutionQuery?.removeEventListener("change", watchResolution);
      resize();
      resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolutionQuery.addEventListener("change", watchResolution);
    }

    function localPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function releaseGesture() {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (gesture && canvas.hasPointerCapture(gesture.id)) canvas.releasePointerCapture(gesture.id);
      setUi((previous) => previous.panning ? { ...previous, panning: false } : previous);
    }

    function cancel() {
      const gesture = gestureRef.current;
      if (gesture?.mode === "erase") strokesRef.current = gesture.before;
      releaseGesture();
      redraw();
    }

    function notify() {
      revisionRef.current += 1;
      setUi((previous) => ({ ...previous, count: strokesRef.current.length, canUndo: historyRef.current.length > 0 }));
      redraw();
      optionsRef.current.onChange?.({ revision: revisionRef.current, hasInk: strokesRef.current.length > 0 });
    }

    function addPoints(event, gesture) {
      const samples = event.getCoalescedEvents?.() || [];
      // Include the dispatch event as well: some browsers return no coalesced samples.
      for (const sample of [...samples, event]) {
        const point = screenToWorld(localPoint(sample), viewportRef.current);
        const last = gesture.stroke.points.at(-1);
        if (point.x !== last.x || point.y !== last.y) gesture.stroke.points.push(point);
        if (flagBoundaryCrossing(gesture.stroke, point)) {
          warningsRef.current.set(gesture.stroke.id, { cell: gesture.stroke.originCell, startedAt: performance.now() });
        }
      }
    }

    function pointerDown(event) {
      if (gestureRef.current || !event.isPrimary || event.button !== 0) return;
      const pan = tool === "hand" || space || viewportRef.current.zoom < 1;
      if (!pan && optionsRef.current.disabled) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      const point = localPoint(event);
      const world = screenToWorld(point, viewportRef.current);
      const gesture = {
        id: event.pointerId, mode: pan ? "pan" : tool === "eraser" ? "erase" : "draw",
        last: point, before: strokesRef.current,
      };
      if (gesture.mode === "draw") {
        gesture.stroke = {
          id: crypto.randomUUID(),
          points: [world],
          originCell: cellAt(world),
          boundaryStatus: "within_bounds",
          width: 3,
          color: "#171717",
        };
      }
      if (gesture.mode === "erase") {
        gesture.lastWorld = world;
        strokesRef.current = eraseStrokes(strokesRef.current, world, world);
      }
      gestureRef.current = gesture;
      canvas.setPointerCapture(event.pointerId);
      setUi((previous) => ({ ...previous, panning: pan }));
      redraw();
    }

    function pointerMove(event) {
      const gesture = gestureRef.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      if (gesture.mode === "draw") {
        addPoints(event, gesture);
      } else if (gesture.mode === "erase") {
        const samples = event.getCoalescedEvents?.() || [];
        for (const sample of [...samples, event]) {
          const world = screenToWorld(localPoint(sample), viewportRef.current);
          strokesRef.current = eraseStrokes(strokesRef.current, gesture.lastWorld, world);
          gesture.lastWorld = world;
        }
      } else {
        const point = localPoint(event);
        viewportRef.current = {
          ...viewportRef.current,
          offsetX: viewportRef.current.offsetX + point.x - gesture.last.x,
          offsetY: viewportRef.current.offsetY + point.y - gesture.last.y,
        };
        gesture.last = point;
      }
      redraw();
    }

    function pointerUp(event) {
      const gesture = gestureRef.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      pointerMove(event);
      releaseGesture();
      if (gesture.stroke) {
        strokesRef.current = appendStroke(strokesRef.current, gesture.stroke);
      }
      if (strokesRef.current !== gesture.before) {
        historyRef.current = commitEdit(historyRef.current, gesture.before, strokesRef.current);
        notify();
      } else redraw();
    }

    function pointerCancel(event) {
      if (gestureRef.current?.id === event.pointerId) cancel();
    }

    function changeZoom(zoom, anchor = { x: size.width / 2, y: size.height / 2 }) {
      viewportRef.current = zoomAt(viewportRef.current, zoom, anchor);
      setUi((previous) => ({ ...previous, zoom: viewportRef.current.zoom }));
      redraw();
    }

    function wheel(event) {
      event.preventDefault();
      if (gestureRef.current) return;
      const delta = wheelDelta(event, size.height);
      if (event.ctrlKey || event.metaKey) {
        changeZoom(viewportRef.current.zoom * Math.exp(-delta.y * 0.002), localPoint(event));
      } else {
        viewportRef.current = {
          ...viewportRef.current,
          offsetX: viewportRef.current.offsetX - delta.x,
          offsetY: viewportRef.current.offsetY - delta.y,
        };
        redraw();
      }
    }

    function undo() {
      cancel();
      if (!historyRef.current.length) return;
      const restored = undoEdit(historyRef.current, strokesRef.current);
      historyRef.current = restored.history;
      strokesRef.current = restored.strokes;
      notify();
    }

    function clear() {
      cancel();
      if (!strokesRef.current.length || !window.confirm("Clear all handwriting? This cannot be undone.")) return;
      strokesRef.current = clearStrokes(strokesRef.current);
      historyRef.current = [];
      warningsRef.current.clear();
      notify();
    }

    function isEditable(event) {
      const target = event.target;
      return target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
    }

    function keyDown(event) {
      if (isEditable(event)) return;
      if (event.code === "Space" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest("button, a, [role='button']")) {
        event.preventDefault();
        space = true;
        setUi((previous) => previous.space ? previous : { ...previous, space: true });
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    }

    function releaseSpace() {
      space = false;
      setUi((previous) => previous.space ? { ...previous, space: false } : previous);
    }

    function keyUp(event) {
      if (event.code === "Space") releaseSpace();
    }

    function blur() {
      releaseSpace();
      cancel();
    }

    function focusOut(event) {
      if (!root.contains(event.relatedTarget)) blur();
    }

    controllerRef.current = {
      cancel,
      undo,
      clear,
      selectTool(nextTool) {
        cancel();
        tool = nextTool;
        setUi((previous) => ({ ...previous, tool }));
      },
      setZoom(zoom) {
        cancel();
        changeZoom(zoom);
      },
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    watchResolution();
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerCancel);
    canvas.addEventListener("lostpointercapture", pointerCancel);
    canvas.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("keydown", keyDown);
    root.addEventListener("focusout", focusOut);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", resize);

    return () => {
      observer.disconnect();
      resolutionQuery?.removeEventListener("change", watchResolution);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("lostpointercapture", pointerCancel);
      canvas.removeEventListener("wheel", wheel);
      root.removeEventListener("keydown", keyDown);
      root.removeEventListener("focusout", focusOut);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", resize);
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (gesture && canvas.hasPointerCapture(gesture.id)) canvas.releasePointerCapture(gesture.id);
      if (frame !== null) cancelAnimationFrame(frame);
      controllerRef.current = null;
    };
  }, []);

  return {
    rootRef,
    canvasRef,
    ui,
    selectTool: (tool) => controllerRef.current?.selectTool(tool),
    setZoom: (zoom) => controllerRef.current?.setZoom(zoom),
    undo: () => controllerRef.current?.undo(),
    clear: () => controllerRef.current?.clear(),
  };
}

