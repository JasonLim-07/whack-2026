# Inkling — Personalisation & Live Feedback Handoff

**For:** Jason and his Codex agent  
**Source branch:** `feature/personalisation`  
**Goal:** Integrate the tested grammar-learning memory into Inkling's live-feedback experience without creating a second memory system or breaking existing reviews.

## 1. What already works

On `feature/personalisation`, Jamie's implementation:

- Adds **Mandarin-specific grammar categories** to the existing Gemini structured feedback, without another LLM request. Existing/legacy responses remain valid.
- Tracks mistakes over **distinct, completed, accepted writing attempts** using browser `localStorage`, with a safe in-memory fallback and a reset option.
- Shows a **compact, category-specific learning reminder** after two different attempts contain the same type of grammar error.
- Does **not** count pending/unconfirmed OCR, character-shape warnings, correct reviews, or repeated analysis of unchanged handwriting as new mistakes.
- Keeps the memory logic independent of debounce timers and polling.

**Implementation reference:** `web/lib/learning/README.md` documents the actual memory functions. Read that file and the current code before wiring anything up; do **not** guess function names or response fields.

### Browser-tested example

1. Learner writes **`我有三个书。`**. Inkling corrects it to **`我有三本书。`** (incorrect measure word).
2. Learner clears the canvas and writes **`我有三书。`**. Inkling corrects it to **`我有三本书。`** (missing measure word).
3. Inkling recognises that both are **measure-word** difficulties and displays a personalised reminder.

This complete two-attempt flow was demonstrated successfully in the browser. Automated checks previously reported **163 relevant tests passing**, plus ESLint and a Webpack build; rerun affected checks after integration.

## 2. Required learner-facing copy and design

Keep the recurring-mistake reminder **very short** (roughly 1–3 lines), e.g.:

> **Measure words again!** Remember: 三本书 means three books. Try another sentence using 本.

Other categories should use similarly concise and *specific* guidance, not generic praise or invented explanations. If an error category is unknown, fall back to a neutral, accurate message.

### Highlighting conventions

| State | Suggested colour | Meaning |
|---|---|---|
| Confirmed grammar issue | **Red** | A specific error established by the accepted grammar review |
| Uncertain OCR / possible shape issue | **Amber** | Verification needed; **not** proof of an error |
| Repeated learning difficulty | **Purple** | Personalised reminder / recurring-category indicator |
| Validated correct review | **Green** (optional) | No clear errors found |

**Important:** Purple belongs on the *learning reminder/indicator*, not as a replacement for the red grammar-error highlight on the handwritten character. Only highlight a particular square/character when its position is reliably aligned. Reuse the existing highlighting infrastructure—do not create a new canvas system.

## 3. Integration with Jason's live reviews

Keep the responsibilities separate:

- **Live scheduler/debouncer:** decides **when** a review is triggered.
- **Existing OCR → verification → Gemini route:** decides **what was written and what needs correcting**.
- **Learner memory:** records **confirmed grammatical patterns** and decides **what targeted hint to show**.

For every automatic or manual review:

1. Let the existing request and **stale-revision/cancellation guards** complete first.
2. If verification is pending, OCR is ambiguous, or the review is stale/cancelled, **do not record grammar mistakes**.
3. After a valid, accepted grammar result, record that writing attempt **once**, using the actual stable workspace/attempt identity supported by the learning module. Repeated automatic checks of unchanged content must not inflate counts.
4. Use **one shared learner-memory instance** for the workspace, with a **stable workspace ID**. Don't instantiate a separate history for every render or timer tick.
5. Read the memory state to display one compact recurring-error hint when appropriate.
6. The manual **Review** button must continue to work, and use the **same memory** as automatic reviews.
7. Preserve the existing **Reset learning history** action and its expected scope.

**Do not make personalised reminders trigger additional Gemini requests, or change debounce timing automatically in this integration.** Adaptive timing can be added later through an explicit signal if there is time.

## 4. Grammar categorisation

The existing personalisation implementation uses a small set of categories, including:

- `measure_word`
- `word_order` — optionally `time_placement`, `location_placement`, `question_word_placement`, or `other`
- `particle`
- `missing_word`
- `verb_usage`
- `other`

Use the actual schema in the merged code. In particular, **missing measure words and wrong measure words should both contribute to `measure_word`**, so the demonstrated sequence above reliably detects a repeated difficulty. Don't introduce a full subject–verb–object parser or additional LLM call.

## 5. Minimal acceptance checks after merging

- **Two distinct measure-word mistakes:** show the specific purple recurring reminder on the second accepted review.
- **Same drawing reviewed twice:** counts only once, including when triggered automatically.
- **Correct sentence:** no mistake recorded, no incorrect personalised reminder.
- **Pending character confirmation:** does not record a grammar mistake until text is confirmed and grammar review succeeds.
- **Editing, Undo, Clear, cancellation:** stale results do not update memory or restore old highlights.
- **UI:** confirmed grammar errors stay red; uncertainty stays amber; recurring-learning reminder is purple and concise.
- **Reset:** clears learning history without breaking handwriting or reviews.
- **Storage unavailable/corrupt:** app continues without crashing.

Run the affected tests, lint and build; do a short browser smoke test of automatic and manual review. A previously passing test suite does not prove that the new live integration has been tested.

## 6. Constraints and handoff process

- **Do not duplicate** learner storage, categorisation logic, or personalised-tip generation.
- **Do not change** OCR thresholds, stroke-shape checker, JSON confirmation, grid handling, or API contracts unless a concrete compatibility issue requires it.
- Keep `main` stable until the integrated feature passes manual browser checks.
- Coordinate merge ownership: only one teammate should resolve/push integration changes at a time, and nobody should force-push.
- Keep API keys server-side. No handwriting images or unnecessary personal data need to be stored in learner memory.

**Suggested integration approach:** once Jamie has committed and pushed `feature/personalisation`, fetch/merge it into the agreed integration branch, inspect `web/lib/learning/README.md`, wire the existing memory module to the accepted live-review result, then test the examples above. Do not assume the code has been merged merely because this document exists.

## 7. One-sentence pitch explanation

> Inkling doesn't just correct a Chinese sentence—it remembers recurring grammar difficulties and gives short, targeted practice hints as the learner writes.

**Scalability story (future, not implemented):** the learner-memory interface is separate from OCR and grammar analysis, so local browser history could later be backed by authenticated profiles and a database for cross-device progress, without rebuilding the review pipeline.
