# Contributing

Thanks for contributing to Itinerary Workspace.

This project is still evolving quickly, so the most useful contributions are the ones that improve correctness, clarity, and the editing experience without fighting the current architecture.

## Before You Start

Please read:

- [README](./README.md)
- [SECURITY](./SECURITY.md)

For larger changes, open an issue first or describe the proposal clearly in a pull request so the direction can be reviewed before too much implementation work lands.

## Development Setup

1. Clone the repository.
2. Copy the example env file:

```bash
cp .env.example .env.local
```

3. Start in mock mode unless you specifically need live providers.
4. Run the app:

```bash
npm run dev
```

5. Run tests:

```bash
npm test
node --check public/app.js
```

## Contribution Guidelines

### Prefer small, focused pull requests

Good examples:

- one planner behavior change
- one UI improvement
- one adapter fix
- one documentation pass

Avoid mixing unrelated refactors, product changes, and formatting churn in the same PR.

### Preserve the product model

This project is built around one itinerary state shared by:

- `Map`
- `Schedule`
- `Selection`
- `Assistant`

Changes that introduce duplicate sources of truth, divergent view logic, or one-off state outside the planner model should be avoided.

### Respect the current mutation model

There are two intended paths:

- `execute` for direct small edits
- `preview/apply` for larger or assistant-driven edits

If you add new editing behaviors, keep that split explicit.

### Keep secrets out of the repo

- do not commit real API keys
- do not embed credentials in screenshots, tests, or docs
- use `.env.local` for local credentials

## Code Style

Current project conventions:

- keep runtime dependencies minimal
- prefer simple modules over framework-heavy abstractions
- keep frontend logic in sync with planner state semantics
- write tests for planner mutations and routing behavior when changing backend logic
- keep README and docs updated when product shape changes

## Pull Request Checklist

Before opening a PR, make sure:

- tests pass with `npm test`
- browser bundle syntax passes with `node --check public/app.js`
- documentation is updated if behavior changed
- no secrets or local-only files are included
- screenshots are refreshed if the visible UI changed substantially

## What Is Especially Helpful

High-value contributions include:

- planner correctness fixes
- better conflict detection or repair flows
- improved schedule readability
- stronger tests around command translation and itinerary mutation
- docs that make the repo easier to run and understand
