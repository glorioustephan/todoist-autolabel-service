# Contributing

Thanks for your interest in improving `@glorioustephan/todoist-autolabel`. This
project ships as both a CLI and a library, so contributions should keep both
consumption modes healthy.

## Requirements

- **Node.js** ≥ 18.17
- **pnpm** ≥ 10 (`corepack enable && corepack prepare pnpm@latest --activate`)
- A **Todoist** API token and an **Anthropic** API key if you want to exercise
  the live integration locally

## Getting started

```bash
git clone https://github.com/glorioustephan/todoist-autolabel-service.git
cd todoist-autolabel-service
pnpm install
cp env.example .env          # then fill in TODOIST_API_TOKEN + ANTHROPIC_API_KEY
cp labels.example.json labels.json   # adjust to your taxonomy
pnpm run dev
```

The CLI reads `.env` and `labels.json` from the **current working directory**,
not the package root, so you can run `pnpm run dev` (or `node dist/service.js`)
from anywhere that has these files alongside it.

## Useful scripts

| Script             | What it does                                    |
| ------------------ | ----------------------------------------------- |
| `pnpm run dev`     | Run the service via `tsx` (no build step)        |
| `pnpm run build`   | Emit `dist/` via `tsc`                          |
| `pnpm test`        | Run the Vitest suite                             |
| `pnpm test:watch`  | Vitest in watch mode                             |
| `pnpm test:coverage` | Coverage report (v8)                           |
| `pnpm typecheck`   | Type-check `src/` and `tests/`                  |
| `pnpm run commit`  | Conventional-commits prompt via commitizen      |

## Commit conventions

This repository uses **Conventional Commits** so that
[release-please](https://github.com/googleapis/release-please) can derive the
next version automatically from merged PRs.

Use `pnpm run commit` (Commitizen) for an interactive prompt, or write commits
in this shape yourself:

```
feat(sync): add cursor-based pagination for large inboxes
fix(classifier): handle Claude refusal responses
chore(deps): bump @doist/todoist-sdk
docs: clarify .env precedence
```

Prefixes you can expect to use:

- `feat:` — user-visible feature (minor version bump pre-1.0, minor post-1.0)
- `fix:` — bug fix (patch bump)
- `feat!:` / `fix!:` — breaking change (major bump post-1.0)
- `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:` — no version bump

## Pull request checklist

Before opening a PR:

1. `pnpm typecheck` — the project uses strict TypeScript with
   `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
2. `pnpm test` — the suite is fast (~600ms) and is required for green CI.
3. `pnpm run build` — make sure the package emits cleanly.
4. Add or update tests for any behavior change.
5. If you change the public library surface (`src/index.ts`), call it out in
   your PR description; consumers depend on it.

CI runs the same three commands across Node 18, 20, and 22.

## Release flow

You should not need to cut releases manually:

1. PRs merge to `main`.
2. [`release-please`](.github/workflows/release.yml) opens (or updates) a
   release PR that bumps `version`, regenerates `CHANGELOG.md`, and tags.
3. Merging the release PR publishes to npm via the same workflow, using the
   `NPM_TOKEN` repository secret.

To force a release without changes (e.g. infra fix), include
`Release-As: x.y.z` in a commit body — see the release-please docs for the
full list of footers.

## Code style

There is no formatter or linter enforced in CI yet; please match the existing
style:

- ESM throughout, `import x from './foo.js'` with the `.js` extension on
  relative imports.
- Branded ID types (`TaskId`, `ProjectId`, `LabelId`) — go through the
  `asTaskId` / `asProjectId` / `asLabelId` helpers at API boundaries.
- `Result<T, E>` for fallible operations; reserve `throw` for the SDK
  boundary.
- Keep comments scarce — describe the *why*, never the *what*.

## Reporting issues

Open issues at
<https://github.com/glorioustephan/todoist-autolabel-service/issues>. Include:

- Node version, OS
- The Claude model you're using
- A minimal reproduction or relevant log lines (redact your API tokens!)
