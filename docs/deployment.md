---
layout: default
title: Deployment Guide
---

# Deployment Guide

The CLI is just a long-running Node process — pair it with whatever process supervisor you already use. This document walks through three common options.

For the initial setup (`.env`, `labels.json`, tokens), see [`setup.md`](./setup.md).

## Option 1 — PM2

The repository ships an `ecosystem.config.cjs` you can copy as a starting point. **It is not part of the npm package**; check it out of the repo or copy it from GitHub.

```bash
# In the directory that holds your .env and labels.json:
pnpm add -g pm2
pnpm add @glorioustephan/todoist-autolabel
curl -O https://raw.githubusercontent.com/glorioustephan/todoist-autolabel-service/main/ecosystem.config.cjs
pm2 start ecosystem.config.cjs
```

You may need to edit the `script` path in `ecosystem.config.cjs` to point at:

```
./node_modules/@glorioustephan/todoist-autolabel/dist/service.js
```

Useful commands:

```bash
pm2 status              # is it running?
pm2 logs todoist-autolabel
pm2 restart todoist-autolabel
pm2 stop todoist-autolabel
pm2 startup             # generate a system-init hook
pm2 save                # persist the current process list across reboots
```

## Option 2 — systemd (Linux)

Create `/etc/systemd/system/todoist-autolabel.service`:

```ini
[Unit]
Description=Todoist Autolabel Service
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/srv/todoist-autolabel
EnvironmentFile=/srv/todoist-autolabel/.env
ExecStart=/usr/bin/npx @glorioustephan/todoist-autolabel
Restart=on-failure
RestartSec=10s
User=todoist
Group=todoist

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now todoist-autolabel
journalctl -fu todoist-autolabel
```

`WorkingDirectory` must contain your `labels.json` (and a `data/` directory if you're using the default DB path).

## Option 3 — Docker

A minimal `Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++ \
    && npm install -g @glorioustephan/todoist-autolabel \
    && apk del python3 make g++
WORKDIR /data
CMD ["todoist-autolabel"]
```

```bash
docker build -t todoist-autolabel .
docker run -d --name todoist-autolabel \
  --env-file ./.env \
  -v "$PWD/labels.json:/data/labels.json:ro" \
  -v todoist-data:/data/data \
  todoist-autolabel
```

The `better-sqlite3` build tools are only needed at install time; the multi-stage approach above strips them after install.

## Database management

The SQLite database lives at `DB_PATH` (default `<cwd>/data/todoist.db`).

### Backup

```bash
cp data/todoist.db data/todoist.db.$(date +%Y%m%d).backup
```

### Reset (force a full reclassification)

Stop the service, delete the DB, restart it:

```bash
systemctl stop todoist-autolabel    # or `pm2 stop`, etc.
rm data/todoist.db
systemctl start todoist-autolabel
```

The service is idempotent — it will re-evaluate every unlabelled Inbox task on the next sync.

### Inspect classification history

```bash
sqlite3 data/todoist.db \
  "SELECT task_id, status, labels FROM tasks ORDER BY updated_at DESC LIMIT 20;"
```

### Inspect recent errors

```bash
sqlite3 data/todoist.db \
  "SELECT created_at, error_type, error_message FROM error_logs ORDER BY id DESC LIMIT 20;"
```

## Cost estimation

Default model: `claude-haiku-4-5-20251001` (~$1 input / ~$5 output per 1M tokens). Per-task token usage is small (typically <500 input tokens, <100 output).

| Tasks / day | Estimated monthly cost |
| ----------- | ---------------------- |
| 10          | < $0.01                |
| 100         | ~$0.05                 |
| 1,000       | ~$0.50                 |

Switch to `claude-sonnet-4-5-20250929` for higher accuracy on subtle taxonomies (~3× the cost).

## Security notes

- **Never commit `.env`.** It is in the default `.gitignore`.
- Rotate your Todoist and Anthropic tokens periodically.
- The SQLite DB contains task content — back it up to encrypted storage if your inbox is sensitive.

## Updating

```bash
# If you installed globally / via npx:
npm install -g @glorioustephan/todoist-autolabel@latest

# If you pinned in a project:
pnpm update @glorioustephan/todoist-autolabel
```

Then restart your supervisor (`pm2 restart`, `systemctl restart`, `docker restart`).
