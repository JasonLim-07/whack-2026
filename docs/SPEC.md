# Inkling — product and integration specification

## Product vision

Inkling is a browser-based AI handwriting tutor, initially focused on Chinese,
built for the incident.io track at WHACK 2026. Learners write sentences or short
paragraphs with a mouse, finger, pen or stylus and receive contextual feedback
on recognition, grammar and possible character mistakes. Suggestions should
link back to the original handwriting so learners can understand each correction.

## Planned MVP

- Capture handwriting on a browser canvas with structured, ordered strokes.
- Provide basic writing tools: pen, undo and clear.
- Submit a writing snapshot for server-side recognition and contextual review.
- Show recognized text, possible mistakes, explanations and suggested revisions.
- Connect feedback to the relevant strokes or region where recognition permits.
- Provide loading, empty and error states and a way to retry review.

Authentication, databases, persistent learning history and unrelated features
are out of scope unless explicitly approved. AI credentials stay server-side.
Personalisation may use session-level learner preferences; persistence is not
part of the initial MVP.

## Development stages

1. **Scaffold (current):** minimal Next.js App Router application, JavaScript,
   React, Tailwind CSS, ESLint, npm lockfile, documentation and verified startup,
   lint and production build. No whiteboard, AI integration or final UI.
2. **Handwriting:** implement stroke capture and basic tools independently of AI.
3. **Recognition and review:** implement and validate the server API and a
   normalized review response using the agreed contracts.
4. **Integration:** connect handwriting, review and feedback, including failure
   states, stale-result handling and writing-to-feedback references.
5. **Demo readiness:** polish accessibility and responsive layouts, test mouse,
   touch and stylus workflows, then prepare deployment and the hackathon demo.

Build incrementally and preserve working features at each stage.

## Team responsibilities and file ownership

| Developer | Responsibility | Planned ownership |
| --- | --- | --- |
| A | Handwriting whiteboard and tools | `web/components/handwriting/`, `web/lib/handwriting/` |
| B | AI recognition, review API and analysis | `web/app/api/review/`, `web/lib/ai/` |
| C | UI, feedback, personalisation, integration and deployment | `web/app/page.js`, layout/styles, `web/components/feedback/`, `web/components/ui/`, deployment configuration |

These are future boundaries, not placeholder directories to create now. Shared
contracts, dependencies, global configuration and this spec require coordination
before changes. Work on assigned feature branches; do not overwrite teammates'
work or commit/push without instruction.

## Component integration contracts

The following v1 contracts are the planned integration baseline. Implement them
in later stages and coordinate any changes across the affected developers.

### Structured handwriting (A → C → B)

All shared values are JSON-serializable. A writing snapshot has this shape:

```js
{
  version: 1,
  writingId: "writing-1",
  revision: 1,
  canvas: { width: 800, height: 400 },
  strokes: [
    {
      id: "stroke-1",
      pointerType: "pen", // "mouse", "touch" or "pen"
      points: [{ x: 120, y: 80, t: 0, pressure: 0.5 }]
    }
  ]
}
```

Canvas dimensions and point coordinates use logical CSS pixels in the same
coordinate space, independent of device pixel ratio. `t` is milliseconds since
the start of that stroke; pressure is in [0, 1], with 0.5 as a fallback. Stroke
and point order are preserved. IDs are stable within a writing session; revision
increases after every content change, including undo and clear. Empty input uses
an empty strokes array. Images may supplement strokes but never replace them.

The planned client `HandwritingCanvas` accepts `value` (the snapshot),
`onChange(nextSnapshot)` and `disabled`. A owns pointer handling and tools; C owns
the current snapshot and submission state. Keep browser APIs in client components.

### Review endpoint (C → B)

Planned route: `POST /api/review`, JSON request:

```js
{
  writing: { /* structured handwriting snapshot above */ },
  language: "zh",
  learnerContext: { level: "beginner" } // optional
}
```

B validates input and keeps provider-specific requests and credentials inside
server modules. If an image is required by the chosen provider, agree its
encoding and request limits before adding that optional field. No API route or
provider is implemented during scaffolding.

Successful responses use HTTP 200 and this normalized shape:

```js
{
  version: 1,
  writingId: "writing-1",
  revision: 1,
  recognizedText: "我学习中文。",
  suggestedText: "我学习中文。",
  feedback: [
    {
      id: "feedback-1",
      category: "recognition", // "recognition", "grammar" or "character"
      message: "Explain the possible issue in learner-friendly language.",
      suggestion: "Suggested replacement", // optional
      target: {
        strokeIds: ["stroke-1"],
        textRange: { start: 0, end: 1 },
        bounds: { x: 100, y: 60, width: 40, height: 50 }
      }
    }
  ]
}
```

`target` and each of its fields are optional: do not invent precise locations
when recognition is uncertain. Text ranges are zero-based, start-inclusive,
end-exclusive JavaScript string indices into `recognizedText`. Bounds use the
submitted canvas coordinate space. Stroke IDs must refer to submitted strokes.
An empty feedback array means no issues were identified; do not promise that
the writing is correct. Recognition uncertainty must be communicated as such.

Errors use `{ error: { code, message } }` with an appropriate non-2xx status:
400 invalid/empty input, 413 excessive input, 429 rate limited, 502 provider
failure or 500 unexpected server failure. Never expose credentials or raw
provider error details. Set concrete payload limits when implementing the API.

### Feedback and orchestration (B → C → A)

C owns review submission, loading/error states and the last response. Associate
responses with both writing ID and revision; discard responses for an edited
snapshot. Preserve handwriting on failure. The planned `FeedbackPanel` receives
`review`, `selectedFeedbackId` and `onSelectFeedback(feedbackId)`. C resolves the
selected target and coordinates highlighting with A through a future optional
`highlightedStrokeIds` canvas prop. Text-only feedback remains usable when no
handwriting target is available.

## Verification and local development

Run the app and all npm commands from `web/`. Each change should pass ESLint
and a production build. Verify local HTTP startup for scaffold changes; later
stages add focused validation for stroke integrity, API schemas, errors and
cross-component behavior. See the root README for commands.
