# Todoist Autolabel Service

An intelligent task classification service for Todoist that automatically labels tasks in your Inbox using local machine learning with Claude Haiku fallback.

## Features

- **Incremental Sync**: Efficiently polls Todoist every 15 seconds using incremental sync
- **Local ML Classification**: Uses Transformers.js with DistilBERT for zero-shot classification
- **Claude Haiku Fallback**: Falls back to Claude Haiku API when local ML confidence is low
- **SQLite Persistence**: Tracks classification state and errors in a local database
- **PM2 Management**: Production-ready with automatic restarts and log management
- **Inbox-Only Processing**: Only classifies tasks in your Todoist Inbox

## Quick Start

### 1. Install Dependencies

```bash
npm install
npm install -g pm2
```

### 2. Configure Environment

Create a `.env` file:

```bash
TODOIST_API_TOKEN=your_token_here
ANTHROPIC_API_KEY=your_key_here  # Optional
```

### 3. Build and Run

```bash
npm run build
npm run pm2:start
```

## Documentation

- [Setup Guide](./docs/setup.md) - Installation and configuration
- [Deployment Guide](./docs/deployment.md) - PM2 management and operations

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PM2 Process Manager                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   Sync Loop  │───▶│  Classifier  │───▶│  Todoist Update  │  │
│  │  (15s poll)  │    │  (Local ML)  │    │      API         │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│         │                   │                     │             │
│         ▼                   ▼                     ▼             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    SQLite Database                          ││
│  │  ┌─────────┐  ┌───────────────┐  ┌──────────────────────┐  ││
│  │  │  tasks  │  │  sync_state   │  │     error_logs       │  ││
│  │  └─────────┘  └───────────────┘  └──────────────────────┘  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## How It Works

1. **Poll**: Every 15 seconds, syncs with Todoist using incremental sync
2. **Filter**: Only processes new/changed tasks in the Inbox
3. **Classify**: Uses local ML model to suggest labels
4. **Fallback**: If confidence is low, falls back to Claude Haiku
5. **Apply**: Updates task labels in Todoist
6. **Track**: Records classification state in SQLite

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run in development mode |
| `npm run pm2:start` | Start with PM2 |
| `npm run pm2:stop` | Stop PM2 process |
| `npm run pm2:restart` | Restart PM2 process |
| `npm run pm2:logs` | View PM2 logs |
| `npm run pm2:status` | Check PM2 status |

## Configuration

Environment variables (`.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `TODOIST_API_TOKEN` | Required | Todoist API token |
| `ANTHROPIC_API_KEY` | - | Claude API key (optional fallback) |
| `POLL_INTERVAL_MS` | `15000` | Polling interval |
| `CLASSIFICATION_CONFIDENCE_THRESHOLD` | `0.6` | Min ML confidence |
| `MAX_ERROR_LOGS` | `1000` | Max error log entries |
| `DB_PATH` | `./data/todoist.db` | Database path |
| `LOG_LEVEL` | `info` | Log verbosity |

## Labels

Labels are defined in `todoist/labels.json`. The service will classify tasks using these labels.

## License

ISC

