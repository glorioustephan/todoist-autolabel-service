# Setup Guide

This guide walks you through setting up the Todoist Autolabel Service.

## Prerequisites

- **Node.js** v18 or higher
- **npm** (comes with Node.js)
- **PM2** (will be installed globally)
- Todoist account with API access
- Anthropic API key for Claude classification

## Installation

### 1. Clone and Install Dependencies

```bash
cd /path/to/todoist
npm install
```

### 2. Install PM2 Globally

```bash
npm install -g pm2
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```bash
# Required
TODOIST_API_TOKEN=your_todoist_api_token_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Claude Configuration (Structured Outputs requires Sonnet 4.5 or Opus 4)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
MAX_LABELS_PER_TASK=5

# Service Configuration (defaults shown)
POLL_INTERVAL_MS=15000
MAX_ERROR_LOGS=1000
DB_PATH=./data/todoist.db
LOG_LEVEL=info
```

### Getting Your API Tokens

#### Todoist API Token
1. Go to [Todoist Integrations Settings](https://todoist.com/app/settings/integrations/developer)
2. Scroll down to "API token"
3. Copy your token

#### Anthropic API Key
1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an account or sign in
3. Navigate to API Keys
4. Create a new key

## Labels Configuration

The service uses labels defined in `./labels.json`. This file should contain your label taxonomy and match what is in Todoist:

```json
{
  "labels": [
    { "name": "home-and-property", "color": "teal" },
    { "name": "financial", "color": "blue" },
    { "name": "health", "color": "green" }
  ]
}
```

The Structured Outputs feature ensures Claude can only return labels that exist in your taxonomy.

## Build the Service

Compile TypeScript to JavaScript:

```bash
npm run build
```

## First Run

Test the service manually first:

```bash
npm run dev
```

On first run, the service will:
1. Connect to Claude API
2. Perform a full sync with Todoist
3. Begin classifying unclassified tasks in your Inbox

## Directory Structure

After setup, your project should have:

```
todoist/
├── data/              # SQLite database (created automatically)
│   └── todoist.db
├── dist/              # Compiled JavaScript
├── docs/              # Documentation
├── logs/              # PM2 logs (created when using PM2)
├── src/               # TypeScript source
├── labels.json        # Label taxonomy
├── .env               # Environment variables
├── ecosystem.config.cjs  # PM2 configuration
└── package.json
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TODOIST_API_TOKEN` | Yes | - | Your Todoist API token |
| `ANTHROPIC_API_KEY` | Yes | - | Claude API key for classification |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-4-5-20250929` | Claude model to use |
| `MAX_LABELS_PER_TASK` | No | `5` | Maximum labels to assign per task |
| `POLL_INTERVAL_MS` | No | `15000` | Polling interval in milliseconds |
| `MAX_ERROR_LOGS` | No | `1000` | Max error log entries before purge |
| `DB_PATH` | No | `./data/todoist.db` | SQLite database path |
| `LOG_LEVEL` | No | `info` | Log level (debug, info, warn, error) |

## Claude Model Options

| Model | Speed | Cost | Best For |
|-------|-------|------|----------|
| `claude-sonnet-4-5-20250929` | Fast | ~$3/1M tokens | Recommended default |
| `claude-opus-4-20250514` | Slower | ~$15/1M tokens | Complex taxonomies |

> **Note**: This service uses Claude's Structured Outputs feature, which requires Claude Sonnet 4.5 or Claude Opus 4.

## Classification Behavior

### How It Works
1. Service polls Todoist every 15 seconds using incremental sync
2. New/changed tasks in the Inbox are identified
3. Tasks without labels are sent to Claude for classification
4. Claude analyzes the task and returns labels using Structured Outputs
5. Labels are applied to the task in Todoist
6. Classification state is recorded in SQLite

### Structured Outputs

The classifier uses Claude's [Structured Outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs) feature to guarantee:
- Valid JSON responses (no parsing errors)
- Only labels from your taxonomy can be returned
- No retry logic needed for malformed responses

### Retry Logic
- Failed classifications are retried on subsequent poll cycles
- Maximum 3 attempts per task
- Errors are logged to SQLite for debugging

### API Credits
- If Claude API credits are exhausted, errors are logged
- Tasks will be retried when credits are available
- Monitor your Anthropic dashboard for usage

## Troubleshooting

### "TODOIST_API_TOKEN environment variable is not set"
Ensure your `.env` file exists and contains the token.

### "ANTHROPIC_API_KEY environment variable is not set"
The Anthropic API key is required. Add it to your `.env` file.

### Tasks not being classified
1. Ensure tasks are in your Inbox (other projects are ignored)
2. Check Claude API key is valid
3. Ensure you're using a supported model (Sonnet 4.5 or Opus 4)
4. View logs: `npm run pm2:logs`

### Database locked errors
Only one instance of the service should run. Stop any existing instances:
```bash
npm run pm2:stop
```

### API Rate Limiting
If you see rate limit errors:
1. Increase `POLL_INTERVAL_MS` in `.env`
2. The service has built-in 200ms delays between API calls

## Next Steps

See [deployment.md](./deployment.md) for instructions on running the service with PM2.
