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

- `web/app/`: App Router layout, minimal home page and global Tailwind styles.
- `web/`: npm scripts, locked dependencies and build/lint configuration.
- [`docs/SPEC.md`](docs/SPEC.md): product vision, stages, ownership and planned
  integration contracts. Read before implementing features.
- [`AGENTS.md`](AGENTS.md): team development rules.

This milestone contains the scaffold only. No whiteboard, AI provider, review
API or final UI is implemented. No environment variables are required to run it.
