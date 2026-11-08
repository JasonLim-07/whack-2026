"use client";

import { pendingWarnings } from "@/lib/review/mistakes.mjs";

const explanation = (entry) => entry.evidence === "confirmed" ? "Matches a previously confirmed character confusion."
  : entry.evidence === "suspected" ? "Similar recognition uncertainty appeared in separate writing attempts."
    : "An uncertain recognition; this is not a proven handwriting error.";

export function MistakeWarnings({ history, onNavigate, onDismiss }) {
  const warnings = pendingWarnings(history);
  if (!warnings.length) return null;
  return <section role="alert" aria-label="Repeated handwriting checks" className="mb-4 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
    <div className="flex items-center justify-between gap-3">
      <p className="font-semibold">Check these recurring character difficulties</p>
      <button type="button" onClick={() => onDismiss(warnings.map((entry) => entry.id))} className="rounded border border-amber-400 px-2 py-1">Dismiss warnings</button>
    </div>
    <ul>{warnings.map((entry) => <li key={entry.id}>
      <button type="button" onClick={() => onNavigate(entry)} className="mt-2 rounded px-2 py-1 text-left underline focus-visible:outline-2">
        <span lang="zh-Hans">{entry.recognized || "Unclear writing"}</span>: {explanation(entry)} Open correction.
      </button>
    </li>)}</ul>
  </section>;
}

export default function MistakeNotifications({ history, selectedId, onNavigate, onDismiss }) {
  const active = history.occurrences.filter((entry) => entry.status === "active" || entry.status === "needs-review");
  const archived = history.occurrences.filter((entry) => entry.status === "resolved" || entry.status === "removed");
  const rank = (entry) => (entry.priority === "high" ? 2 : 0) + (entry.evidence === "confirmed" ? 1 : 0);
  function list(entries) {
    return <ul className="space-y-2">{[...entries].sort((a, b) => rank(b) - rank(a)).map((entry) => {
      const confirmation = history.confirmations.find((record) => record.occurrenceId === entry.id);
      return <li key={entry.id}>
        <button type="button" aria-pressed={selectedId === entry.id} onClick={() => onNavigate(entry)}
          className={`w-full rounded-lg border p-3 text-left text-sm focus-visible:outline-2 ${selectedId === entry.id ? "border-blue-500 bg-blue-50" : "border-neutral-200"}`}>
          <span className="block font-medium"><span lang="zh-Hans">{entry.recognized || "Unclear writing"}</span> · {entry.priority === "high" ? "High" : "Low"} priority</span>
          {confirmation && <span className="block text-xs"><span lang="zh-Hans">{confirmation.recognized ?? entry.recognized} → {confirmation.intended}</span> · {entry.status === "resolved" || entry.status === "removed" ? "User confirmed." : "Earlier confirmation."}</span>}
          <span className="block text-xs text-neutral-600">{!confirmation && "Suspected. "}{explanation(entry)}</span>
          {!entry.bounds && <span className="block text-xs text-neutral-600">Location unavailable.</span>}
          {entry.locationKind === "region" && <span className="block text-xs text-neutral-600">Writing region located; the character is not yet recognised.</span>}
          {entry.status !== "active" && <span className="block text-xs text-neutral-600">{entry.status === "removed" ? "Earlier writing removed" : entry.status === "needs-review" ? "Writing edited — review again" : "Resolved"}</span>}
        </button>
        {onDismiss && entry.status === "active" && <button type="button" onClick={() => onDismiss(entry)} className="px-2 py-1 text-xs underline">Dismiss suggestion</button>}
      </li>;
    })}</ul>;
  }
  if (!active.length && !archived.length) return null;
  return <details className="text-xs text-neutral-500">
    <summary className="cursor-pointer focus-visible:outline-2">Handwriting checks and session history</summary>
    <section aria-label="Handwriting checks" className="mt-3 space-y-3">
    {active.length ? list(active) : <p className="text-sm text-neutral-500">No outstanding character checks.</p>}
    {archived.length > 0 && <details><summary className="mb-2 cursor-pointer text-sm">Session history ({archived.length})</summary>{list(archived)}</details>}
  </section></details>;
}
