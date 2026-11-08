# Inkling — WHACK 2026

A browser-based Chinese handwriting tutor by Jason, Jamie and Johan.

## Local development

Install Node.js 24 LTS (includes npm). With nvm, run `nvm install` and `nvm use`
from `web/` to use the version specified in `.nvmrc`.

```sh
cd web
npm ci
npm run dev
```

Open http://localhost:3000. Stop the server with Ctrl+C.

## Checks and production startup

Run these from `web/`:

```sh
npm run lint
npm run build
npm start
```

`npm start` serves the production build at http://localhost:3000.

## Project structure

- `web/app/`: integrated review workspace, review API route, isolated whiteboard demo,
  App Router layout and global Tailwind styles.
- `web/`: npm scripts, locked dependencies and build/lint configuration.
- [`docs/SPEC.md`](docs/SPEC.md): product vision, stages, ownership and planned
  integration contracts. Read before implementing features.
- [`AGENTS.md`](AGENTS.md): team development rules.

## Writing review

The home page connects the handwriting canvas to `POST /api/review`. Write a short
Mandarin sample and press **Review**. All remaining handwriting, including offscreen
strokes, is exported as a cropped PNG. The grid and amber boundary warnings are
excluded. Editing pauses during review; pan and zoom remain available.

**Writing Review** opens as a right sidebar on desktop and a bottom drawer on
smaller screens. Closing it preserves feedback and handwriting. Writing changes
invalidate previous feedback. `/whiteboard-demo` remains an isolated drawing demo.

Configure server credentials in gitignored `web/.env.local` before live review:

- `GEMINI_API_KEY` is required by grammar analysis.
- OCR accepts `GOOGLE_CLOUD_VISION_API_KEY` or `GEMINI_OCR_API_KEY` (and the existing
  fallback key names in the OCR module). `OCR_PROVIDER` can be `vision`, `gemini`,
  or `auto`. Ask the backend owners which provider/key combination to use.
- Restart the dev server after changing its environment. Never put keys in
  `NEXT_PUBLIC_` variables or commit `.env.local`.

On this Windows setup, live Google requests required the system certificate store.
If review fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, restart from `web/` using
Node.js 24 with certificate verification still enabled:

```powershell
node --use-system-ca node_modules/next/dist/bin/next dev
```

Run the offline unit/integration checks from `web/` (no credentials or paid requests):

```sh
node --test lib/handwriting/*.test.mjs lib/review/*.test.mjs lib/ai/*.test.mjs lib/ai/transcribe.test.js
```

Manual checks: review correct and incorrect sentences, collapse/reopen the panel,
review writing after panning it offscreen, check mobile layout, retry failures,
and verify eraser/undo/clear are locked during requests and usable afterward.
Exports above 4096 pixels per side or 5 MiB are rejected without changing ink.
