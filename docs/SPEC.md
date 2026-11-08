# Inkling — Product and Integration Specification

## 1. Product vision

Inkling is a browser-based Chinese handwriting tutor developed for the incident.io track at WHACK 2026.

The target user is a learner practising written Mandarin, such as a GCSE Chinese student.

Instead of photographing handwritten sentences and manually submitting them to an AI chatbot, the learner writes directly onto a digital whiteboard, requests a review and receives understandable feedback alongside the handwriting.

The immediate goal is a working end-to-end MVP, not a complete personalised learning platform.

## 2. Confirmed MVP

The MVP consists of five steps:

1. **Whiteboard:** The learner writes Chinese characters on a browser canvas using a mouse, finger or stylus. Pen, eraser, undo and clear are available.
2. **Image capture:** The completed writing can be exported as a PNG image.
3. **OCR:** An existing recognition model reads the image and returns the recognised Chinese text, together with genuine confidence data if available.
4. **Grammar analysis:** A language model analyses the recognised text and returns structured JSON containing corrections and concise English explanations.
5. **Feedback display:** The whiteboard interface shows the recognised text and grammar feedback in a panel.

The user presses **Review** to start the process.

The app should demonstrate the complete sequence:

**Handwriting → PNG → OCR → Chinese text → Grammar LLM → Structured JSON → Feedback panel**

## 3. Scope restrictions

The following are not part of the initial MVP:

- Training or fine-tuning a handwriting model.
- Automatic analysis after writing pauses.
- Character-level highlighting on the canvas.
- Detecting individual incorrect strokes or stroke order.
- Personalised handwriting recognition.
- Persistent learning history or user-specific model memory.
- Persistent caching, authentication or databases.
- Browser extensions or additional languages.
- Arbitrary multi-page document processing.

The initial experience should prioritise one handwritten Chinese sentence or a short writing sample. Longer paragraphs are a later enhancement.

Future functionality should not delay the end-to-end MVP.

## 4. Technology and repository

One GitHub repository: `whack-2026`.

Stack:

- Next.js App Router
- React and JavaScript
- Tailwind CSS
- Next.js API routes
- Node.js and npm
- An existing Chinese handwriting OCR provider
- An existing LLM API for grammatical analysis

The application is located at `web/`.

Actual Next.js routing directory: `web/app/`.

Do not introduce a separate Python server or second application for the MVP.

### Planned file structure

- `web/app/page.js` — final integrated application page, Jamie.
- `web/app/api/review/route.js` — server API endpoint, Jamie.
- `web/app/whiteboard-demo/page.js` — Jason's independent test page.
- `web/components/handwriting/HandwritingCanvas.jsx` — canvas component, Jason.
- `web/components/feedback/FeedbackPanel.jsx` — feedback display component, Jason.
- `web/lib/handwriting/` — stroke utilities, Jason.
- `web/lib/ai/ocr.js` — recognition module, Johan.
- `web/lib/ai/grammar.js` — grammar module, Jamie.

These are planned files and folders. Each developer creates only what their assigned work requires.

## 5. Developer ownership

### Jason — Whiteboard (`feature/whiteboard`)

Implement the handwriting canvas, drawing tools, PNG export and feedback display.

Requirements:

- Smooth drawing with pointer input.
- Support mouse, touch and stylus.
- Pen, eraser, undo and clear.
- Preserve drawing data as ordered strokes internally.
- Export a clear PNG, with dark handwriting on a white background.
- Maintain a drawing revision number that changes when handwriting is edited.
- Provide a feedback panel capable of displaying mock review results.
- Create an isolated whiteboard demonstration page for testing.

Jason must not implement the OCR or grammar providers.

Jason should not modify `web/app/page.js` during independent development.

### Johan — OCR (`feature/ocr`)

Implement image-based Chinese handwriting recognition.

Requirements:

- Accept an image as a server-side Node.js `Buffer`.
- Support PNG input.
- Use an existing OCR or vision provider.
- Return the text as recognised, without grammar correction.
- Preserve any available provider confidence data.
- Return `null` when an overall confidence score is unavailable.
- Never fabricate a confidence score using an LLM.
- Handle blank images, unreadable text and provider failures.
- Test using saved handwritten Chinese images.

Johan should test independently of Jason's unfinished whiteboard.

Johan must not create the main review endpoint or implement grammar analysis.

### Jamie — Grammar and integration (`feature/tutor`)

Implement the grammatical analysis module and server-side review endpoint.

Requirements:

- Accept a typed Chinese sentence from the OCR module.
- Analyse grammar and character usage using an existing LLM.
- Produce consistent structured JSON, with English explanations.
- Avoid inventing mistakes in grammatically correct sentences.
- Validate model responses before returning them.
- Implement the combined review endpoint.
- Initially test using hardcoded Chinese examples.
- Connect Johan's recognition module and Jason's whiteboard during integration.
- Handle loading states, request errors and outdated results.

Jamie owns the main application page during integration.

## 6. Shared component contracts

These interfaces are mandatory for the initial implementation. Do not independently rename fields or change parameter types.

### 6.1 Jason: HandwritingCanvas

Location: `web/components/handwriting/HandwritingCanvas.jsx`

Default-export a React component named `HandwritingCanvas`.

Supported props:

- `onChange({ revision, hasInk })` — called after changes to handwriting.
- `disabled` — optional boolean that disables drawing.

Expose an imperative method through a React ref:

- `exportImage()` — returns `Promise<Blob>` containing a PNG image.

The ref also exposes `exportSnapshot()`, returning `Promise<{ image, revision, bounds }>` captured consistently. `bounds` contains `left`, `top`, `width` and `height` in world units. The method includes completed strokes without interrupting an active pen stroke; during an unfinished eraser gesture it captures the pre-gesture completed state.

Optional `onEditStart()` and `onEditEnd()` callbacks signal active pen/eraser gestures separately from committed drawing revisions. Optional `grammarHighlights` (world-coordinate rectangles) and `selectedIssueId` render review overlays without changing stored ink.

The returned `Blob` must have MIME type `image/png`.

PNG export must include all remaining completed handwriting, including offscreen strokes, cropped to its world-space bounds with 24 units of white padding. Export at one pixel per world unit, independent of pan, zoom and display pixel ratio. It must use a solid white background and omit the grid, boundary warnings, feedback panel and toolbar. Include boundary-flagged strokes without filtering. Reject empty writing, exports above 4096 pixels per side, or PNG files above 5 MiB; do not silently downscale. This all-handwriting policy was agreed during fullintegration/mvp integration.

The canvas maintains structured strokes internally, including stroke IDs and ordered points, so that erasing and undo are reliable.

`revision` must increase when writing is added, erased, undone or cleared.

Jason may use a drawing library if useful, but should not create a second application or backend.

### 6.2 Jason: FeedbackPanel

Location: `web/components/feedback/FeedbackPanel.jsx`

Default-export a React component named `FeedbackPanel`.

Supported props:

- `review` — combined response from the review endpoint, or `null`.
- `loading` — boolean.
- `error` — error message or `null`.
- `onReview` — callback invoked when the user presses Review.

The panel must be able to display:

- Recognised Chinese text.
- Overall OCR confidence when available.
- Suggested corrected Chinese text.
- Each grammar issue and its English explanation.
- A clear no-issues message when the issues array is empty.
- Loading and error states.

Jason should use mock review data while building and testing the component.

The final page will connect `onReview` to the real API.

### 6.3 Johan: OCR function

Location: `web/lib/ai/ocr.js`

Provide the named export:

`async function recogniseHandwriting(imageBuffer, mimeType = "image/png")`

Input:

- `imageBuffer`: a Node.js `Buffer` containing the handwriting image.
- `mimeType`: image MIME type, initially `image/png`.

Output object:

- `text`: recognised Chinese string, preserving the model's transcription.
- `confidence`: number between 0 and 1, or `null`.
- `segments`: array of available recognised text segments, each containing `text` and `confidence` (number or `null`).

Example:

- `text`: `我有两个书。`
- `confidence`: `null`
- `segments`: `[]`

A non-null overall confidence value must be supported by a confidence score genuinely reported for the full recognised text by the provider.

If the provider only reports scores for smaller segments, include those in `segments` and leave overall `confidence` as `null`. Do not manufacture an overall score.

If no confidence data is available, return `null` and an empty segments array.

The OCR function must not intentionally correct grammar or change the user's wording to make the sentence more natural.

If recognition fails, throw a meaningful error for the server to handle. Do not return invented Chinese text.

Keep API credentials on the server.

### 6.4 Jamie: Grammar function

Location: `web/lib/ai/grammar.js`

Provide the named export:

`async function analyseGrammar(text, options = {})`

Input:

- `text`: recognised Chinese string.
- `options.level`: optional learner level, default `beginner`.

Output object:

- `correctedText`: suggested corrected Chinese sentence.
- `issues`: array of structured grammar or usage issues.

Each issue contains:

- `id`: stable identifier within the response.
- `type`: `grammar`, `word_choice` or `character`.
- `original`: original Chinese substring.
- `replacement`: suggested replacement, or an empty string for a deletion.
- `explanation`: concise explanation in English.
- `start`: inclusive Unicode code-point offset into the exact original OCR text.
- `end`: exclusive Unicode code-point offset. `Array.from(text).slice(start, end).join("")` must equal `original`. Insertions use `start === end` and an empty `original`. Repeated substrings require the correct explicit range; never infer the first match or count UTF-16 code units.

Example input: `我有两个书。`

Example output:

- `correctedText`: `我有两本书。`
- `issues`: one issue identifying `个`, proposing `本`, and explaining that books use the measure word `本`.

Rules:

- Use Simplified Chinese.
- Explain corrections in accessible English.
- Identify clear grammatical and character-usage mistakes.
- Do not invent mistakes in valid sentences.
- Accept multiple grammatically valid constructions.
- Avoid unnecessary stylistic rewrites.
- Do not pretend to assess physical stroke quality from OCR text.
- Return an empty issues array when no clear mistakes are identified.
- When there are no issues, return the input text unchanged as `correctedText`.
- Validate the structured output returned by the LLM.
- Treat ambiguous cases cautiously.

The grammar module must not implement handwriting recognition.

### 6.5 Jamie: Combined review endpoint

Location: `web/app/api/review/route.js`

Endpoint: `POST /api/review`

Request content type: `multipart/form-data`.

Fields:

- `image`: required PNG image file.
- `level`: optional string, initially `beginner`.
- `revision`: optional non-negative integer representing the handwriting revision.

Server processing:

1. Validate the request and image.
2. Convert the uploaded PNG into a Node.js Buffer.
3. Call `recogniseHandwriting(imageBuffer, "image/png")`.
4. Reject an empty or unreadable transcription with an appropriate error.
5. Call `analyseGrammar(recognition.text, { level })`.
6. Return a combined JSON response.

Successful response fields:

- `recognizedText`: original OCR transcription.
- `ocrConfidence`: overall OCR confidence number or `null`.
- `ocrSegments`: OCR segments array.
- `ocrCharacters`: ordered `{ text, start, end, bounds }` entries aligned with the original transcription. Offsets use the same Unicode code-point convention as grammar issues. Bounds are `{ x, y, width, height }` in exported PNG pixels or `null` when unavailable. Return `[]` if character slots cannot be aligned to the transcription. Use actual PNG dimensions when converting normalised provider boxes.
- `correctedText`: suggested corrected sentence.
- `issues`: grammar issues array.
- `revision`: supplied revision number, or `null` when omitted.

Example conceptual response:

- `recognizedText`: `我有两个书。`
- `ocrConfidence`: `null`
- `ocrSegments`: `[]`
- `correctedText`: `我有两本书。`
- `issues`: one grammar issue for `个` → `本`.
- `revision`: `3`

The server must not expose API keys or raw provider error details.

Use appropriate error statuses, including:

- `400` for invalid requests or unreadable content.
- `413` for excessively large images.
- `429` for rate limiting.
- `502` for upstream OCR or language-model failures.
- `500` for unexpected server failures.

Errors use a JSON object with an `error` field containing `code` and `message`.

Set a reasonable image upload limit, initially 5 MB.

## 7. End-to-end review flow

The final integrated page performs the following steps:

1. The learner writes Chinese on `HandwritingCanvas`.
2. The learner presses Review.
3. The application calls `exportImage()` to obtain the PNG Blob.
4. The application constructs `FormData` containing `image`, `level` and the current `revision`.
5. The browser sends the data to `POST /api/review`.
6. The server calls Johan's OCR module.
7. The server passes the recognised text into Jamie's grammar module.
8. The server returns the combined JSON.
9. The application passes the response to Jason's `FeedbackPanel`.

While a request is running, show a loading state.

If handwriting changes during review, do not display outdated feedback for the old revision.

If the request fails, preserve the student's handwriting and show a useful error message.

The user should be able to retry without losing their writing.

## 8. Independent development and testing

### Jason's independent milestone

A browser page where the user can:

- Draw Chinese characters.
- Erase, undo and clear.
- Export a PNG.
- View a feedback panel using mock response data.

Test with both a mouse and a touch or stylus device if available.

### Johan's independent milestone

A standalone OCR function that:

- Receives a saved PNG.
- Returns actual recognised Chinese characters.
- Returns available provider-reported confidence data.
- Handles unreadable handwriting and provider errors.

Test several real handwritten sentences, including correct sentences and grammatical mistakes.

The OCR output must not silently fix those mistakes.

### Jamie's independent milestone

A standalone grammar function that:

- Receives typed Chinese.
- Detects a genuine grammar error.
- Returns valid structured JSON.
- Returns no issues for a correct sentence.
- Handles malformed LLM output and API errors.

The review endpoint should be tested with a temporary mock recognition result until Johan's OCR module is available.

## 9. Integration strategy

All three developers work on independent Git feature branches.

Branch ownership:

- Jason: `feature/whiteboard`
- Johan: `feature/ocr`
- Jamie: `feature/tutor`

After the independent milestones have been committed, pushed and tested:

1. Create `integration/mvp` from the updated `main`.
2. Merge the three feature branches.
3. Resolve any Git conflicts without discarding another developer's work.
4. Connect the OCR module to the grammar module.
5. Connect the completed review API to the whiteboard and feedback panel.
6. Test the full workflow using real handwriting.
7. Run lint and production build checks.
8. Merge the integration branch into `main` only after the MVP works.

Merge and test early. Do not wait for visual polish before testing the real end-to-end workflow.

## 10. MVP test cases

Test at least the following examples with typed text and, where possible, handwritten input.

**Correct:**

`我是学生。`

Expected: no grammar errors.

**Missing measure word:**

`我有三书。`

Expected: suggestion to use `三本书`.

**Incorrect measure word:**

`我有两个书。`

Expected: suggestion to replace `个` with `本`.

**Incorrect word order:**

`我你爱。`

Expected: correction to `我爱你。`

Also test:

- Empty canvas.
- Unreadable handwriting.
- Ambiguous OCR recognition.
- API key or provider failure.
- Editing the handwriting while a review is in progress.
- Repeated Review requests.
- Mouse, touch and stylus interactions.

Test OCR transcription accuracy separately from grammar-correction accuracy.

Do not count an OCR mistake as a grammar mistake made by the student.

## 11. Security and reliability

- API calls requiring secrets happen only on the server.
- Store credentials in `web/.env.local`.
- Never commit environment files containing secrets.
- Validate uploaded image type and size.
- Validate JSON returned by the grammar model.
- Never show invented OCR confidence values.
- Do not store identifiable student handwriting unnecessarily.
- Preserve the user's writing on errors.
- Avoid unnecessary model calls.

The MVP does not require a database or personalised handwriting model.

## 12. Verification

Run commands from `web/`:

- `npm run dev` — run locally.
- `npm run lint` — check linting.
- `npm run build` — verify the production build.

A successful build is necessary but not sufficient. The complete handwriting-to-feedback flow must be tested manually.

## 13. Post-MVP possibilities

Only after the core workflow works reliably, consider:

- Editable recognised transcription before grammar analysis.
- Automatic review after an inactivity period.
- Highlighting the affected handwritten character or region.
- Adaptive learner-level explanations.
- Session-level caching of unchanged handwriting reviews.
- Personalised learning history.
- Character formation and stroke-order guidance.
- Longer paragraphs and multi-line notebook layouts.

These are enhancements, not prerequisites for the MVP.

## 14. Definition of done

The MVP is complete when a user can:

1. Open Inkling.
2. Handwrite a short Chinese sentence.
3. Press Review.
4. Receive a genuine OCR transcription and available confidence data.
5. Receive structured grammar feedback in English.
6. View the feedback beside the original handwriting.

The complete interaction must work in the browser without manually transferring images or text between applications.

## Current whiteboard guidance and review overlays

- Grid cells remain 96 world units. Soft boundary tolerance is 10% (9.6 units); a significant crossing produces one amber outline and a 1.6-second fading message per stroke. Flagged strokes and their cell markers remain until removed.
- Pen/Eraser gestures below 100% pan and show a concise writing-scale message. Hand and Space pan at every zoom.
- The 100% button sets zoom to exactly one, selects Pen, and centres the last point of the latest remaining stroke. With no ink it preserves the current world centre. Slider/wheel zoom retains its existing anchor behaviour.
- Editing stays available during AI review. Starting an edit cancels the pending client request and clears stale results/overlays before the drawing revision changes. Late responses are ignored. Clear and Undo also invalidate review results.
- Review retains the snapshot export origin locally. Convert OCR boxes to world coordinates by adding `bounds.left` and `bounds.top`; do not infer a character-to-cell mapping from grid order. Highlight only located existing characters; show insertion indicators in typed text, without assigning them to unrelated ink.
- Feedback cards are keyboard-selectable and emphasise matching text/ink highlights. Selection does not move the viewport. Overlays, markers and guidance never enter PNG export.

## Approved post-MVP incremental checking extension

The user-requested incremental checkers extend the initial manual-only MVP scope.
The main workspace recognises changed grid regions after a 1.5-second writing pause,
keeps session transcription and recognition caches, and checks completed reliable
or confirmed sentences automatically. A manual Check grammar action supports
unfinished text. Original strokes, IDs, sequence and timestamps are preserved;
Undo/Redo invalidates affected results and reuses unchanged recognition. The legacy
Review endpoint and full PNG export contracts remain unchanged. Formation checks
remain advisory, and reliable stroke-order assessment is explicitly unsupported.
See `docs/incremental-checkers.md` for interfaces, limitations and verification.
