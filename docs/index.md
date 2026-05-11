---
layout: default
title: Documentation
---

# @glorioustephan/todoist-autolabel

> Auto-classify Todoist Inbox tasks with **Claude AI** using **Structured Outputs** — guaranteed-valid label assignments, no retry parsing, no malformed JSON.

```bash
npx @glorioustephan/todoist-autolabel
```

[![npm](https://img.shields.io/npm/v/@glorioustephan/todoist-autolabel.svg)](https://www.npmjs.com/package/@glorioustephan/todoist-autolabel)
[![CI](https://github.com/glorioustephan/todoist-autolabel-service/actions/workflows/ci.yml/badge.svg)](https://github.com/glorioustephan/todoist-autolabel-service/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-DC4C3E.svg)](https://github.com/glorioustephan/todoist-autolabel-service/blob/main/LICENSE)

---

## Documentation

- **[Setup guide](./setup.md)** — install, configure `.env` and `labels.json`, get API tokens, first run.
- **[Deployment guide](./deployment.md)** — run as a long-lived daemon with PM2, systemd, or Docker.
- **[Repository on GitHub](https://github.com/glorioustephan/todoist-autolabel-service)** — source, issues, CHANGELOG.

## What it does

1. Polls your Todoist Inbox on an interval.
2. Skips completed tasks and anything already labelled.
3. Sends each remaining task to Claude with a schema-constrained `output_format`. The model can only emit names from **your** taxonomy — no hallucinated labels, no malformed JSON.
4. Patches the labels back to Todoist.
5. Persists state in a local SQLite DB so retries don't double-classify.

## Getting started in 60 seconds

```bash
mkdir my-autolabel && cd my-autolabel

# Scaffold .env + labels.json in the current directory
npx @glorioustephan/todoist-autolabel init

# Edit .env to add your tokens, then run
npx @glorioustephan/todoist-autolabel
```

See the **[setup guide](./setup.md)** for the full walkthrough, model options, and troubleshooting.

## Library usage

```ts
import {
  loadConfig,
  initDatabase,
  initTodoistApi,
  initClassifier,
  initSyncManager,
  getSyncManager,
} from '@glorioustephan/todoist-autolabel';

const config = loadConfig();
initDatabase(config);
await initTodoistApi(config);

const classifier = await initClassifier(config);
if (!classifier.success) throw new Error(classifier.error);

initSyncManager(config);
await getSyncManager().sync();
```

Fallible operations return `Result<T, E>` — there's no surprise throwing past the SDK boundary.

## License

[MIT](https://github.com/glorioustephan/todoist-autolabel-service/blob/main/LICENSE) © glorioustephan
