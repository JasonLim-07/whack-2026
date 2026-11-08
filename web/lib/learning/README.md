# Learner memory integration

`createLearnerMemory(storage?)` from `memory.mjs` creates one memory instance per workspace. The default is browser localStorage; `null` gives session-only memory. Blocked/full storage degrades to in-memory statistics. There are no timers, network calls, images, sentence text or learner identifiers in storage.

Call these instance methods after the existing cancellation/revision guards have accepted a response:

- `recordCompletedReview(review, { sessionId, revision })`: records a successful grammar review, returning whether this is a new completed attempt. Generate an opaque `sessionId` with `crypto.randomUUID()` once per mounted workspace. Reuse it and the canvas drawing revision for manual reviews, automatic reviews, retries and JSON confirmation. Never generate a new session ID for each request.
- `getDifficultyCategories()`: returns copies of `categories` and `wordOrderSubcategories`, each mapping the fixed category names to counts of distinct attempts.
- `getPersonalisedTip(review)`: returns one category-specific tip or `null`. A tip needs at least two counted attempts and a matching genuine error in this review. More specific word-order tips need two occurrences of that subcategory.
- `resetLearningHistory()`: clears all counts and attempt identities, including persisted state when available.

Each category/subcategory counts at most once per attempt, regardless of issue count. A per-session revision high-water mark excludes duplicate and out-of-order reviews, including issue-free completed attempts. The original drawing revision is also used for confirmed text. Pending OCR, unresolved verification and advisory character/shape warnings are excluded. Legacy grammar issues without category metadata remain valid but do not contribute statistics.

The schema stores only versioned aggregate counts and one opaque session/revision pair per workspace session. Local statistics belong to this browser profile; they are not account-based. Writes are best effort, without cross-tab transactions. Reset starts fresh; a subsequent review may count the current drawing again.

Jason's live-feedback trigger can call exactly the same methods after receiving a current completed review. Debouncing and scheduling stay outside this module.
