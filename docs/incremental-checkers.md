# Incremental Mandarin checking

## Behaviour

The main workspace now owns a session-only digital transcription. Character
recognition runs after 1.5 seconds without a writing/erasing gesture. Only dirty
grid regions are exported; unchanged regions retain their literal OCR result,
confidence provenance, world-coordinate boxes, and explicit user confirmations.
Recognition is sequential, and recognition and grammar have separate cancellation
controllers, loading states, errors, and retry actions.

Strokes keep IDs, ordered points, a start timestamp, and per-point timestamps.
Undo/redo restores the same objects/IDs and sequence. New committed edits clear
redo. Clear retains the existing explicit, non-undoable behaviour. Restoring an
identical region reuses cached recognition without manufacturing another attempt.

Grid-crossing strokes merge intersecting occupied cell rectangles. Such groups
require explicit text/order confirmation. Tiny marks may include only their
immediately preceding square as recognition context. Provider boxes determine
which returned characters belong to the target square; the neighbour's stored
transcription is never overwritten. An exact stored-prefix match followed only
by reported punctuation can be separated without inventing boxes. Other results
without sufficient boxes require explicit target-text confirmation. This is grid-guided recognition, not a general
freeform document segmentation system.

The application review cutoff is now **below 0.60**, rather than below 0.90.
`web/lib/ai/recognitionPolicy.mjs` centralises this adjustable policy. Scores are
provider reports, not accuracy probabilities; original values remain unchanged.
Unknown character scores and fallback-model transcriptions still require
confirmation. Bundled synthetic-template mismatches no longer generate blocking
warnings by default: normal handwriting variation is not evidence of a mistake.
This policy applies to the incremental and legacy review endpoints; the raw OCR
adapter's tiers are retained for compatibility.

Small baseline dots and closed circles after recognised/confirmed Han text have
a conservative local stroke-geometry fallback. It supports the next square or a
clearly separated mark at the lower right of the same square, including a mark
omitted by OCR. Existing character mappings and literal provider text are retained;
the added mark is labelled `stroke_geometry` with confidence `null`. Commas,
dashes, open/large rings, upper dots, marks inside a provider character box, and
marks after digits are excluded. This fallback is grid-guided and cannot resolve
every ambiguous mark; unclear punctuation can still be confirmed manually.

Grammar operates on stored text. Completed sentences ending in `。！？.!?` are
checked automatically once their transcription is reliable or confirmed. Decimal
points between digits do not end sentences. **Check grammar** also checks
unfinished/unpunctuated text. Uncertain text blocks checking for that sentence.
Punctuation edits rebuild sentence boundaries and invalidate affected feedback.
The model is instructed to provide minimal GCSE-level corrections, including word
order, measure words, particles, negation, questions and contextual character use.

Suggestions can be dismissed and their explanations expanded. Accepting a grammar
suggestion changes only the digital correction view. It never edits the original
ink or becomes evidence of a confirmed handwriting confusion. Confirmation and
repetition tracking reuse the existing session-history reducer. Region observations
carry the complete current stroke inventory locally, so checking one region does
not mark unrelated handwriting as deleted.

## APIs and reuse

- `POST /api/recognition`: bounded multipart PNG region, optional existing spatial
  metadata, and revision. Reuses OCR and coverage checks with the gentler review policy;
  never invokes grammar. Boxes remain crop-relative on the wire.
- `POST /api/grammar`: existing text JSON shape (`text`, `level`, `revision`), with
  `gcse` supplied by the client. Returns validated grammar with Unicode code-point
  issue ranges. Never invokes OCR.
- `POST /api/review`: unchanged legacy full-image/manual review flow. The main
  Review button still provides that explicit action; automatic checks use the new
  endpoints. The isolated whiteboard demo remains available.

OCR transport has a 30-second deadline and receives request cancellation. Grammar
uses its existing 30-second deadline and now receives cancellation too. Provider
errors remain sanitised. Recognition regions are limited to 4096 pixels per side
and 5 MiB; oversized regions fail without silent downscaling.

Both caches are in memory, limited to 256 entries, and discarded on unmount.
Recognition keys use stroke IDs, widths and ordered point data. Grammar keys use
exact sentence text and learner level. Edited sentences receive new content/ink
fingerprints, so late responses cannot replace newer results. PNG blobs are not
retained in the recognition cache. No database, persistent cache, new dependency,
or custom model is added.

## Capability limits

Recognition uncertainty and advisory shape differences are not proof of bad
handwriting. Shape comparisons cover only bundled synthetic reference glyphs and
supported PNG formats. They do not establish reliable stroke formation, expected
character identity, or stroke order. Reliable assessment requires suitable
character references, tolerances validated against real handwriting, and a
sequence-comparison method. The app records sequence/timing for future work and
does not claim these assessments are already supported.

Missing/ambiguous character boxes prevent reliable ink highlighting. Explicit
whole-region transcription edits may also lose per-character geometry. These
cases retain typed feedback and correction controls. OCR provider availability,
quotas and real handwriting quality still determine live recognition reliability.

### Isolated-character recovery

Cloud Vision can return HTTP 200 with no detections for a clearly visible isolated
glyph. The region endpoint now makes one bounded recovery attempt with the existing
Gemini credentials and `GEMINI_OCR_MODEL`, falling back to the configured
`GEMINI_MODEL` when the OCR-specific setting is absent. It does not pick an
unconfigured model version or modify environment files. Recovery transcriptions
always require confirmation; Gemini self-rated confidence remains `null`.

When all recognizers return no text, the client retains the known stroke region,
labels it as a located **region**, and offers direct Chinese-text confirmation
and a targeted retry. This region box is not presented as a provider character
location and cannot independently prove character-confusion repetition. Partial
stroke additions update the same occurrence instead of creating history entries.
The transcription and correction controls appear above the history list.

An explicit single-Han-character-to-single-Han-character confirmation can retain
an actual provider box and record the stated confusion. Longer arbitrary text
edits remain unaligned. `tests/fixtures/isolated-di.svg` is a synthetic regression
sample: the primary recognizer returned empty text for it, while the configured
Gemini model recognised `弟`. This is not the user's original captured stroke data.

## Changed files

New modules: `web/lib/handwriting/incrementalRegions.mjs`,
`web/lib/review/transcription.mjs`, `incrementalClient.mjs`,
`incrementalChecker.mjs`; new endpoints under `web/app/api/recognition/` and
`web/app/api/grammar/`; new UI `web/components/feedback/IncrementalFeedback.jsx`.

Updated integration: `WritingWorkspace.jsx`, `HandwritingCanvas.jsx`,
`useWhiteboard.js`, `WhiteboardToolbar.jsx`, `FeedbackPanel.jsx`,
`MistakeNotifications.jsx`, `strokes.mjs`, `mistakes.mjs`,
`web/lib/ai/review.js`, `reviewOcr.js`, and `grammar.js`.

New checker, endpoint and UI tests accompany these modules. The fixture proxy in
`web/scripts/preview-mistakes.mjs` now handles the new recognition/grammar routes.

## Verification

From `web/`, run:

```powershell
node --test lib/review/*.test.mjs lib/handwriting/*.test.mjs lib/ai/*.test.mjs lib/ai/tests/ocr.test.js components/feedback/*.test.mjs
npm.cmd run lint
npm.cmd run build
```

For deterministic UI checking, run Next on port 3000, then
`node scripts/preview-mistakes.mjs` in another terminal and open
`http://127.0.0.1:3100`. This fixture proxy never calls OCR or LLM providers. It
returns a synthetic `末`/`未` choice. Draw across a square boundary to exercise
whole-region confirmation, enter `我有三书。`, and verify automatic grammar
feedback about the missing measure word. Test waiting, additional writing,
confirmation, dismissal, Undo/Redo, and manual Check grammar without punctuation.
Use port 3000 for real services. Synthetic fixtures do not establish real OCR or
model accuracy; record real-provider and browser checks separately.

### Verification record

- 235 automated tests passed, covering the new coordinator, HTTP endpoints,
  feedback components and existing recognition/grammar/whiteboard behaviour.
- ESLint and the production build passed.
- The gentler-policy regression checks cover the 0.60 boundary, moderate scores,
  unknown scores, unchanged provider values, and non-blocking template differences.
- Full-stop regression checks cover dots/circles in adjacent and shared squares,
  OCR omission, context without boxes, uncertainty confirmation, rejected commas
  and character dots, grammar deduplication, removal, and undo restoration.
- A live HTTP/coordinator check using synthetic `我有书` strokes returned genuine
  OCR scores of 0.96, 0.86, and 0.96 without confirmation prompts. Adding a baseline
  dot required no fourth OCR request and triggered exactly one successful grammar
  request for `我有书.`. The provider returned no grammar issues. This is a
  functional regression check, not an accuracy study of real handwriting.
- Live production recognition returned HTTP 200 for the bundled third CASIA line,
  with nine located characters and provider-reported segment scores. The fixture
  has a JPEG signature despite its `.png` name, so it was converted to PNG in
  memory before upload; the fixture on disk was not changed.
- Live production grammar returned HTTP 200, correcting `我有两个书。` to
  `我有两本书。` with one measure-word issue.
- The isolated-glyph regression returned `弟` through the live region endpoint,
  requiring confirmation with no fabricated confidence. A live coordinator check
  produced one ink highlight; explicitly confirming `第` retained one character
  box and recorded `弟 → 第` as the user-stated confusion.
- Browser interaction verification could not run because the browser-access host
  was unavailable. Component rendering/events, controller behaviour and HTTP
  checks are automated; they do not replace mouse/touch/stylus browser testing.

This machine's initial provider calls failed certificate-chain verification.
Tests succeeded with Node's system certificate store enabled; certificate
validation was not disabled. If needed, stop the old dev process and run this
from `web/`:

```powershell
node --use-system-ca node_modules/next/dist/bin/next dev
```

Restart an already-running dev server after adding the new endpoints if it
reports stale module exports. No API credentials or global trust settings were
changed.
