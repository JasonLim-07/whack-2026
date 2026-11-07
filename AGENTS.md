# Inkling — WHACK 2026

Inkling is a browser-based Chinese handwriting learning app for the incident.io track at WHACK 2026.

## Technology

- Next.js App Router, React, JavaScript, Tailwind CSS.
- Next.js server-side API routes.
- Browser canvas supporting mouse, touch and stylus.
- Existing OCR and language-model APIs; no custom model training for the MVP.
- npm for dependency management.
- Project root: `web/`. Application routes live in `web/app/`, not `web/src/app/`.

## MVP

The initial MVP consists of exactly five capabilities:

1. A functional handwriting whiteboard with pen, eraser, undo and clear.
2. Capture the handwriting and export a PNG image.
3. OCR that converts handwritten Chinese into typed Chinese, with genuine provider-reported confidence scores where available.
4. An LLM that analyses the recognised Chinese and returns structured grammar feedback with English explanations.
5. Display the recognised text, suggested corrections and feedback in the whiteboard's feedback panel.

The user initiates analysis using a **Review** button.

## Development principles

- **Always read `docs/SPEC.md` before writing code.**
- Implement only your assigned feature unless explicitly asked to integrate.
- Build incrementally, preserving working functionality.
- Prefer straightforward, maintainable code over unnecessary complexity.
- Keep handwriting as structured strokes internally, even though OCR receives a PNG.
- Do not silently correct the OCR transcription before grammar analysis.
- Never fabricate OCR confidence scores. Use `null` when unavailable.
- OCR confidence is not necessarily a calibrated probability.
- Return predictable, validated JSON between modules.
- Keep API credentials server-side in gitignored environment files.
- Never expose API keys in browser code, logs or commits.
- Handle empty input, API failures and unexpected model responses.
- Do not add databases, authentication, persistent user memory or custom model training.
- Do not build automatic review, personalisation, character highlighting or stroke-order assessment until the MVP works.
- Run relevant lint, build and functionality checks after changes.
- Report files changed, tests performed and remaining problems.

## Team responsibilities

### Jason — Whiteboard

Branch: `feature/whiteboard`

Owns:

- `web/components/handwriting/`
- `web/lib/handwriting/`
- `web/components/feedback/`
- `web/app/whiteboard-demo/` for isolated testing

Responsibilities:

- Responsive handwriting canvas.
- Mouse, touch and stylus input.
- Pen, eraser, undo and clear.
- Structured stroke storage.
- PNG export.
- Feedback panel accepting the agreed response format.
- Standalone demonstration using mock feedback.

Do not modify the main application page or implement OCR and grammar APIs.

### Johan — OCR recognition

Branch: `feature/ocr`

Owns:

- `web/lib/ai/ocr.js`
- OCR-related test scripts and fixtures.

Responsibilities:

- Research and test a suitable Chinese handwriting OCR provider.
- Implement image-to-text recognition.
- Return the original transcription and available provider confidence data.
- Test recognition on actual handwritten PNG images.
- Handle unreadable images and provider errors.

Do not implement grammar analysis, the review API route or application UI.

### Jamie — Grammar, review API and integration

Branch: `feature/tutor`

Owns:

- `web/lib/ai/grammar.js`
- `web/app/api/review/route.js`
- `web/app/page.js` during integration.

Responsibilities:

- Send recognised Chinese text to an LLM for grammar analysis.
- Return structured JSON with corrections and English explanations.
- Validate model output and handle errors.
- Implement the server-side `POST /api/review` endpoint.
- Initially test the grammar engine with hardcoded Chinese text.
- Integrate Johan's OCR and Jason's whiteboard when ready.
- Manage the final end-to-end flow.

Do not rewrite other developers' modules unnecessarily.

## Shared integration contracts

Follow the exact interfaces defined in `docs/SPEC.md`.

- Jason's `HandwritingCanvas` exports a PNG `Blob`.
- Johan's `recogniseHandwriting(imageBuffer, mimeType)` returns recognised text and confidence metadata.
- Jamie's `analyseGrammar(text, options)` returns corrected text and structured issues.
- `POST /api/review` accepts a PNG using `multipart/form-data`.
- The `FeedbackPanel` displays the combined review response.

Do not change function names, inputs, output schemas or ownership without team agreement.

Any changes to shared dependencies, global configuration, `package.json` or the specification require coordination.

## Git workflow

- One shared GitHub repository: `whack-2026`.
- Each developer works on their own feature branch.
- Never directly develop on `main`.
- Do not switch branches, commit, merge or push automatically unless explicitly requested.
- Make focused, testable changes.
- Do not overwrite unrelated components or another developer's work.
- Integration takes place on `integration/mvp` before merging into `main`.
- Never force-push shared branches without explicit team agreement.

## Verification

Run npm commands from the `web/` directory.

- `npm run lint`
- `npm run build`
- `npm run dev` for local testing.

Test components independently before integration. Preserve error handling and do not treat a successful build as proof that the complete workflow works.