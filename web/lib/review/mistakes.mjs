// Session-only evidence. No OCR score is interpreted as correctness confidence.
export const DEFAULT_MISTAKE_RULES = Object.freeze({ suspectedAttempts: 2, confirmedAttempts: 1 });
export const emptyMistakeHistory = () => ({ version: 1, nextId: 1, occurrences: [], confirmations: [] });
const han = (text) => typeof text === "string" && /^\p{Script=Han}$/u.test(text);
const overlaps = (a, b) => a && b && a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
const dismissalSignature = (entry) => JSON.stringify([entry.strokeIds, entry.recognized, entry.category, entry.strokeIds.length ? null : entry.fallbackKey]);

// Reserved for an explicitly validated correctness signal, not an OCR score.
export function priorityForEvidence({ provenIncorrect = false, confirmedCount = 0, suspectedCount = 0 }, rules = DEFAULT_MISTAKE_RULES) {
  return provenIncorrect || confirmedCount >= rules.confirmedAttempts || suspectedCount >= rules.suspectedAttempts ? "high" : "low";
}

export function strokeBounds(stroke) {
  if (!stroke.points.length) return null;
  const radius = stroke.width / 2;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of stroke.points) {
    left = Math.min(left, point.x); top = Math.min(top, point.y);
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
  }
  return { x: left - radius, y: top - radius, width: right - left + 2 * radius, height: bottom - top + 2 * radius };
}

export function extractMistakes(review, snapshot) {
  const points = Array.from(review.recognizedText);
  const findings = [
    ...(review.characterCandidates ?? []).map((candidate) => ({ start: candidate.position, end: candidate.position + 1,
      recognized: candidate.originalAttempt, alternatives: candidate.options.map((option) => option.char),
      confidence: candidate.confidence ?? null, category: candidate.visuallyUncertain ? "shape" : "recognition", choiceKey: candidate.position })),
    ...(review.intentTargets ?? []).map((target) => ({ start: target.start, end: target.end,
      recognized: target.original, alternatives: [], confidence: null, category: "unclear", choiceKey: target.id })),
  ];
  if (review.requiresTextConfirmation && !findings.length) findings.push({ start: 0, end: points.length,
    recognized: review.recognizedText, alternatives: [], confidence: null, category: han(review.recognizedText) ? "recognition" : "unaligned", choiceKey: null });
  const strokes = snapshot.strokes ?? [];
  const result = findings.map((finding) => {
    const boxes = (review.ocrCharacters ?? []).filter((character) => character.bounds &&
      character.start < finding.end && character.end > finding.start).map((character) => character.bounds);
    // Require complete character coverage before claiming a located finding.
    const covered = (review.ocrCharacters ?? []).filter((character) => character.start >= finding.start && character.end <= finding.end);
    const complete = finding.end > finding.start && covered.map((entry) => entry.text).join("") === points.slice(finding.start, finding.end).join("") && covered.every((entry) => entry.bounds);
    const characterBounds = complete && boxes.length ? {
      x: Math.min(...boxes.map((box) => box.x)) + snapshot.bounds.left,
      y: Math.min(...boxes.map((box) => box.y)) + snapshot.bounds.top,
      width: Math.max(...boxes.map((box) => box.x + box.width)) - Math.min(...boxes.map((box) => box.x)),
      height: Math.max(...boxes.map((box) => box.y + box.height)) - Math.min(...boxes.map((box) => box.y)),
    } : null;
    // A known crop can locate an unread writing region without inventing an OCR
    // character box. This supports navigation/identity, not character certainty.
    const regionBoxes = !characterBounds && snapshot.scope && findings.length === 1 ? strokes.map(strokeBounds).filter(Boolean) : [];
    const regionBounds = regionBoxes.length ? { x: Math.min(...regionBoxes.map((box) => box.x)), y: Math.min(...regionBoxes.map((box) => box.y)),
      width: Math.max(...regionBoxes.map((box) => box.x + box.width)) - Math.min(...regionBoxes.map((box) => box.x)),
      height: Math.max(...regionBoxes.map((box) => box.y + box.height)) - Math.min(...regionBoxes.map((box) => box.y)) } : null;
    const bounds = characterBounds ?? regionBounds;
    const strokeIds = regionBounds ? strokes.map((stroke) => stroke.id).sort()
      : bounds ? strokes.filter((stroke) => overlaps(strokeBounds(stroke), bounds)).map((stroke) => stroke.id).sort() : [];
    return { ...finding, bounds, strokeIds, locationKind: characterBounds ? "character" : regionBounds ? "region" : "unavailable",
      scopeBounds: snapshot.scope?.bounds, reliable: !!characterBounds && han(finding.recognized) && finding.end === finding.start + 1 && strokeIds.length > 0,
      fallbackKey: JSON.stringify([strokes.map((stroke) => stroke.id).sort(), finding.start, finding.end]),
      contextStrokeIds: strokes.map((stroke) => stroke.id),
      attemptStrokes: bounds ? strokes.filter((stroke) => strokeIds.includes(stroke.id)) : strokes,
      sourceReview: review, sourceRevision: review.revision, snapshotBounds: snapshot.bounds };
  });
  // A stroke shared by multiple OCR slots cannot prove separate attempts.
  return result.map((finding) => ({ ...finding, reliable: finding.reliable && !result.some((other) => other !== finding &&
    other.strokeIds.some((id) => finding.strokeIds.includes(id))) }));
}

function prioritise(state, rules) {
  const currentConfirmation = (entry) => state.confirmations.find((record) => record.occurrenceId === entry.id &&
    record.recognized === entry.recognized && record.strokeIds.length === entry.strokeIds.length &&
    record.strokeIds.every((id) => entry.strokeIds.includes(id)));
  const isDismissed = (entry) => {
    const record = currentConfirmation(entry);
    return record !== undefined && record.recognized === record.intended;
  };
  const occurrences = state.occurrences.map((entry) => {
    const pair = currentConfirmation(entry);
    const dismissed = isDismissed(entry);
    const suspects = state.occurrences.filter((other) => other.detected && other.reliable && other.category === entry.category && other.recognized === entry.recognized &&
      !isDismissed(other));
    const confirmed = state.confirmations.filter((record) => record.occurrenceId !== entry.id && record.recognized === entry.recognized &&
      record.recognized !== record.intended && (entry.alternatives.includes(record.intended) || pair?.intended === record.intended) &&
      state.occurrences.some((other) => other.id === record.occurrenceId && other.reliable));
    const evidence = entry.reliable && !dismissed && confirmed.length >= rules.confirmedAttempts ? "confirmed"
      : entry.reliable && !dismissed && suspects.length >= rules.suspectedAttempts ? "suspected" : "first";
    const resolved = entry.resolution?.recognized === entry.recognized && entry.resolution.strokeIds.length === entry.strokeIds.length &&
      entry.resolution.strokeIds.every((id) => entry.strokeIds.includes(id));
    const suggestionDismissed = entry.dismissedSignature === dismissalSignature(entry);
    const status = !entry.live ? "removed" : entry.changed ? "needs-review" : pair || resolved || suggestionDismissed || !entry.detected ? "resolved" : "active";
    const priority = priorityForEvidence({ confirmedCount: evidence === "confirmed" ? confirmed.length : 0,
      suspectedCount: entry.reliable && !dismissed ? suspects.length : 0 }, rules);
    return { ...entry, priority, evidence,
      warningAcknowledged: entry.warningAcknowledged || ((priority === "high" || entry.priority === "high") && ["removed", "resolved"].includes(status)), status };
  });
  return { ...state, occurrences };
}

export function mistakeReducer(state, action) {
  const rules = { ...DEFAULT_MISTAKE_RULES, ...action.rules };
  if (action.type === "acknowledge") return { ...state, occurrences: state.occurrences.map((entry) =>
    action.ids.includes(entry.id) ? { ...entry, warningAcknowledged: true } : entry) };
  if (action.type === "dismiss") return prioritise({ ...state, occurrences: state.occurrences.map((entry) => entry.id === action.id || (action.review && entry.sourceReview === action.review)
    ? { ...entry, dismissedSignature: dismissalSignature(entry), warningAcknowledged: true } : entry) }, rules);
  if (action.type === "drawing") {
    const strokes = action.strokes ?? [];
    const ids = new Set(strokes.map((stroke) => stroke.id));
    return prioritise({ ...state, occurrences: state.occurrences.map((entry) => {
      const present = entry.strokeIds.filter((id) => ids.has(id));
      const added = entry.bounds && strokes.some((stroke) => !entry.strokeIds.includes(stroke.id) && overlaps(strokeBounds(stroke), entry.scopeBounds ?? entry.bounds));
      const live = entry.strokeIds.length ? present.length > 0 : false;
      return { ...entry, live, warningAcknowledged: entry.warningAcknowledged || (!live && entry.priority === "high"),
        changed: present.length !== entry.strokeIds.length || !!added };
    }) }, rules);
  }
  if (action.type === "review") {
    const reconciled = mistakeReducer(state, { type: "drawing", strokes: action.allStrokes ?? action.snapshot.strokes, rules });
    const findings = extractMistakes(action.review, action.snapshot);
    const ids = new Set((action.snapshot.strokes ?? []).map((stroke) => stroke.id));
    let nextId = state.nextId;
    const occurrences = reconciled.occurrences.map((entry) => ({ ...entry,
      detected: entry.strokeIds.length && entry.strokeIds.every((id) => ids.has(id)) ? false : entry.detected }));
    const claimed = new Set();
    for (const finding of findings) {
      const matches = occurrences.filter((entry) => (entry.lineageIds ?? entry.strokeIds).some((id) => finding.strokeIds.includes(id)) ||
        ((!entry.strokeIds.length || !finding.strokeIds.length) && entry.fallbackKey === finding.fallbackKey) ||
        (!entry.bounds && !finding.bounds && entry.start === finding.start && entry.end === finding.end &&
          entry.contextStrokeIds.some((id) => finding.contextStrokeIds.includes(id))));
      const match = matches.find((entry) => !claimed.has(entry.id));
      // Splitting or merging overlapping regions is ambiguous, not new evidence.
      const reliable = finding.reliable && matches.length <= 1 && !matches.some((entry) => claimed.has(entry.id));
      if (match) {
        claimed.add(match.id);
        const lineageIds = [...new Set([...(match.lineageIds ?? match.strokeIds), ...finding.strokeIds])].sort();
        Object.assign(match, finding, { reliable, live: true, changed: false, detected: true,
          lineageIds });
      } else {
        const entry = { ...finding, reliable, id: `mistake-${nextId++}`, live: true, changed: false, detected: true, warningAcknowledged: false };
        occurrences.push(entry);
        claimed.add(entry.id);
      }
    }
    return prioritise({ ...state, nextId, occurrences }, rules);
  }
  if (action.type === "confirm") {
    let confirmations = [...state.confirmations];
    const occurrences = state.occurrences.map((entry) => entry.sourceReview === action.review && entry.live && !entry.changed
      ? { ...entry, resolution: { recognized: entry.recognized, strokeIds: [...entry.strokeIds] } } : entry);
    for (const entry of state.occurrences) {
      if (entry.sourceReview !== action.review || !entry.live || entry.changed) continue;
      const wholeCharacter = action.review.requiresTextConfirmation && han(action.review.recognizedText) && han(action.confirmedText);
      if (action.review.requiresTextConfirmation && !wholeCharacter) continue;
      const intended = wholeCharacter ? action.confirmedText : action.selections[entry.choiceKey];
      if (!han(entry.recognized) || !han(intended) || entry.end !== entry.start + 1) continue;
      const permitted = wholeCharacter || (typeof entry.choiceKey === "number" ? entry.alternatives.includes(intended)
        : action.intentSuggestions?.[entry.choiceKey]?.some((option) => option.text === intended));
      if (!permitted) continue;
      confirmations = confirmations.filter((record) => record.occurrenceId !== entry.id);
      confirmations.push({ version: 1, occurrenceId: entry.id, recognized: entry.recognized, intended,
        strokeIds: [...entry.strokeIds], bounds: entry.bounds });
    }
    return prioritise({ ...state, occurrences, confirmations }, rules);
  }
  return state;
}

export const pendingWarnings = (state) => state.occurrences.filter((entry) => entry.status === "active" && entry.priority === "high" && !entry.warningAcknowledged);
export const mistakeOverlays = (state) => state.occurrences.filter((entry) => entry.live && !entry.changed && entry.detected && entry.status !== "resolved" && entry.bounds)
  .map((entry) => ({ ...entry.bounds, issueId: entry.id }));
