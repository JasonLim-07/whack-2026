# Session handwriting checks

The workspace keeps OCR uncertainties and confirmed character choices in memory
until the page is reloaded or unmounted. Nothing is saved to browser storage or a
database. Grammar suggestions stay separate from handwriting repetition evidence.

`web/lib/review/mistakes.mjs` owns the reducer and adjustable thresholds. Two
distinct located attempts with the same recognised Han character and finding
category promote suspicion to high priority. A previous explicitly confirmed
recognised-to-intended confusion is stronger evidence when that intended character
is also an explicit alternative for a fresh occurrence. Overlapping suggestion
lists alone never establish a repeated mistake.

Stroke IDs identify physical attempts. Partial rewrites sharing strokes update
the existing occurrence. Fully replacing the strokes or writing elsewhere creates
another attempt. Undo restores known IDs. Repeated requests and changed OCR text
for the same ink update records in place. Ambiguous or unlocated findings remain
visible but do not establish independent character attempts. Confirming the
recognised character dismisses that occurrence's suspicion. Explicit confirmation
is recorded before grammar analysis, so a failed grammar request loses no intent
and retrying it adds no duplicate correction.

The sidebar retains earlier checks in Session history. Click a live notification
or warning to centre its located ink and focus the correction controls. Edited or
older reviews are inspectable but their controls are disabled until a new review.
High-priority checks use one warning area; dismissal acknowledges each occurrence.
Low-priority checks never produce that warning. Removed ink has no live overlay.

Confirmation records carry `version: 1`, occurrence ID, recognised and intended
characters, stroke IDs, and world-space bounds. This is a serialisable boundary
for a future persistence adapter; persistence is deliberately not implemented.
Canvas snapshots and change events expose cloned completed strokes locally.
They are not sent to the backend. The existing HTTP review contracts are unchanged.

## Backend limitations

- OCR confidence is recognition evidence, not evidence of incorrect handwriting.
  The current backend has no reliable correctness classification. First-time
  shape advisories remain low priority, including high-confidence recognition.
  `priorityForEvidence` supports explicit proven-incorrect evidence for a future
  validated adapter, but the current response adapter never supplies it.
- Broader similar-error grouping needs a documented backend pattern identifier
  or comparable shape evidence. The client does not invent those classifications.
- Missing or ambiguous boxes prevent reliable ink highlighting and attempt
  matching. These checks still have sidebar entries and text/correction access.
- Arbitrary whole-sentence edits cannot establish individual confirmed confusion
  pairs. Explicit single-character choices can.

## Verification

From `web/` run:

```powershell
node --test lib/review/*.test.mjs components/feedback/*.test.mjs lib/handwriting/*.test.mjs
npm.cmd run lint
npm.cmd run build
```

For a deterministic browser check, start `npm.cmd run dev` on port 3000. In a
second terminal run `node scripts/preview-mistakes.mjs`, then open
`http://127.0.0.1:3100`. This loopback-only fixture proxy supplies synthetic `末`
recognition with `未` as an alternative. It never calls OCR or LLM providers and
does not modify production routes. Use one character at a time because the fixture
deliberately returns one character covering the exported image.

1. Draw a character, Review, and check its low-priority sidebar entry and ink/text
   highlight. Re-review unchanged ink: there must still be only one entry.
2. Select `未` and confirm. The entry moves to history with the confirmed choice.
3. Erase the entire attempt, write another character, and Review. Its compatible
   uncertainty is high priority with confirmed-confusion wording.
4. Click the warning: the viewport centres the ink and focuses its choices. Dismiss
   the warning and re-review: no duplicate entry or repeat warning appears.
5. Undo or edit the ink: obsolete overlays disappear and cached controls become
   read-only. Restore known strokes: no additional repetition is counted.
6. Reload the page to reset all session evidence. For suspected-only promotion,
   repeat the two fresh attempts without confirming the first one.

The fixture preview is for verification only. Use port 3000 for real recognition.
