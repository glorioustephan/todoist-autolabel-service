# Setup Guide

This guide walks you through standing up the autolabel service on your own machine.

For an overview, see the [README](../README.md).

## Prerequisites

- **Node.js** ≥ 20.18.1 (required by `@doist/todoist-sdk`)
- A **Todoist** account with API access
- An **Anthropic** API key (Claude)
- *(Recommended)* **pnpm** ≥ 10, or **npm** / **yarn** / **bun** — any will work as long as you can run a Node bin.

## Install

### Option A — run directly with `npx`

No install required:

```bash
npx @glorioustephan/todoist-autolabel
```

`npx` will resolve the latest published version and run it against the `.env` and `labels.json` files in your current directory.

### Option B — pin in a project

```bash
pnpm add @glorioustephan/todoist-autolabel
```

Then either invoke it via the project's package scripts, or run the bin:

```bash
pnpm exec todoist-autolabel
```

## Configure

The service reads configuration from **two files in the current working directory**:

### `.env`

Copy the template and fill in your credentials:

```bash
cp node_modules/@glorioustephan/todoist-autolabel/env.example .env
```

The only required variables are:

```bash
TODOIST_API_TOKEN=your_todoist_token
ANTHROPIC_API_KEY=your_anthropic_key
```

Everything else has a sensible default — see the [full env reference](#environment-variables-reference) below.

### `labels.json`

This is your Todoist label taxonomy. Every entry must already exist as a label in Todoist.

A starting point (red/grey themed to match Todoist's palette) is published with the package as `labels.example.json`:

```json
{
  "labels": [
    { "name": "urgent",   "color": "red" },
    { "name": "waiting",  "color": "grey" },
    { "name": "errands",  "color": "red" },
    { "name": "work",     "color": "berry_red" },
    { "name": "personal", "color": "grey" }
  ]
}
```

Save your taxonomy as `labels.json` in the same directory as `.env`. The `color` values use [Todoist's named palette](https://developer.todoist.com/api/v1/#tag/Labels) (e.g. `red`, `berry_red`, `grey`, `charcoal`, `taupe`, `sky_blue`, …).

## Get your API tokens

### Todoist

1. Open Todoist → Settings → **Integrations** → **Developer** tab.
2. Copy the **API token** at the bottom of the page.

### Anthropic

1. Sign in at <https://console.anthropic.com/>.
2. Go to **API Keys** and create a new key.
3. Make sure your account has credits / a billing method attached.

## First run

```bash
npx @glorioustephan/todoist-autolabel
```

On boot the service will:

1. Validate `.env` and connect to the Anthropic + Todoist APIs.
2. Resolve your Inbox project (walking pagination if necessary).
3. Open / create the SQLite DB at `DB_PATH`.
4. Begin its sync loop — every `POLL_INTERVAL_MS` it pulls Inbox tasks without labels and classifies them.

Stop it with `Ctrl+C`. The shutdown handler closes the DB cleanly.

## Environment variables reference

| Variable              | Required | Default                                  | Description                                              |
| --------------------- | -------- | ---------------------------------------- | -------------------------------------------------------- |
| `TODOIST_API_TOKEN`   | yes      | —                                        | Todoist API token                                        |
| `ANTHROPIC_API_KEY`   | yes      | —                                        | Anthropic API key                                        |
| `ANTHROPIC_MODEL`     | no       | `claude-haiku-4-5-20251001`              | Any Claude model with Structured Outputs support        |
| `MAX_LABELS_PER_TASK` | no       | `5`                                      | Hard cap on labels per task                              |
| `POLL_INTERVAL_MS`    | no       | `15000`                                  | Polling interval in ms                                   |
| `MAX_ERROR_LOGS`      | no       | `1000`                                   | FIFO cap on `error_logs`                                 |
| `DB_PATH`             | no       | `<cwd>/data/todoist.db`                  | SQLite DB location                                       |
| `LABELS_PATH`         | no       | `<cwd>/labels.json`                      | Override the labels file location                        |
| `LOG_LEVEL`           | no       | `info`                                   | `debug` &#124; `info` &#124; `warn` &#124; `error`       |

## Supported Claude models

Structured Outputs (and therefore this service) requires **Claude Haiku 4.5+, Sonnet 4.5+, or Opus 4+**. Earlier models will fail at the API.

| Model                            | Speed   | Cost (in/out per 1M)  | Best for                       |
| -------------------------------- | ------- | --------------------- | ------------------------------ |
| `claude-haiku-4-5-20251001`      | Fastest | ~$1 / ~$5             | Default — cheapest and fastest |
| `claude-sonnet-4-5-20250929`     | Fast    | ~$3 / ~$15            | Subtle / ambiguous taxonomies  |
| `claude-opus-4-20250514`         | Slower  | ~$15 / ~$75           | Very large taxonomies          |

## Troubleshooting

### `TODOIST_API_TOKEN environment variable is not set`
The CLI loads `.env` from the **current working directory**, not from where the package is installed. Make sure you're running the command from the directory that holds your `.env`.

### `Could not find Todoist Inbox project`
The token does not have access to a project flagged `inboxProject`. Double-check the token belongs to the right account, or regenerate it from the Todoist developer settings.

### Tasks aren't being classified
1. Make sure the tasks are in your **Inbox** — the service intentionally ignores other projects.
2. Make sure the tasks have no labels yet — labelled tasks are skipped to avoid clobbering manual work.
3. Confirm the model in `ANTHROPIC_MODEL` is one of the supported ones above.
4. Re-run with `LOG_LEVEL=debug` for verbose output.

### `Database locked`
Only one instance of the service should run against a given `DB_PATH` at a time. Stop the duplicate, or point one of them at a different `DB_PATH`.

### Rate-limit errors from Todoist
The service inserts a 200 ms delay between writes, but if you have a lot of unlabelled tasks plus heavy other Todoist usage, raise `POLL_INTERVAL_MS` (e.g. to `300000` for 5 min).

## Next steps

- [Deployment guide](./deployment.md) for running this as a long-lived daemon (PM2, systemd, Docker).
- [CONTRIBUTING.md](../CONTRIBUTING.md) if you want to hack on the codebase itself.
