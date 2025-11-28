# Setup Guide

This guide walks you through setting up the Todoist Autolabel Service on your Mac Mini.

## Prerequisites

- **Node.js** v18 or higher
- **npm** (comes with Node.js)
- **PM2** (will be installed globally)
- Todoist account with API access
- (Optional) Anthropic API key for Claude Haiku fallback

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

# Optional - for Claude Haiku fallback classification
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Service Configuration (defaults shown)
POLL_INTERVAL_MS=15000
CLASSIFICATION_CONFIDENCE_THRESHOLD=0.6
MAX_ERROR_LOGS=1000
DB_PATH=./data/todoist.db
LOG_LEVEL=info
```

### Getting Your API Tokens

#### Todoist API Token
1. Go to [Todoist Integrations Settings](https://todoist.com/app/settings/integrations/developer)
2. Scroll down to "API token"
3. Copy your token

#### Anthropic API Key (Optional)
1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an account or sign in
3. Navigate to API Keys
4. Create a new key

## Labels Configuration

The service uses labels defined in `todoist/labels.json`. This file should contain your label taxonomy:

```json
{
  "labels": [
    { "name": "home-and-property", "color": "teal" },
    { "name": "financial", "color": "blue" },
    { "name": "health", "color": "green" }
  ]
}
```

### Syncing Labels to Todoist

Before running the service, ensure all labels exist in your Todoist account. You can use the existing label creation script:

```bash
npx tsx todoist/create-todoist-labels.ts todoist/labels.json
```

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
1. Download the ML model (~400MB) - this happens once
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
├── todoist/           # Original scripts and labels.json
├── .transformers-cache/  # ML model cache
├── .env               # Environment variables
├── ecosystem.config.cjs  # PM2 configuration
└── package.json
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TODOIST_API_TOKEN` | Yes | - | Your Todoist API token |
| `ANTHROPIC_API_KEY` | No | - | Claude API key for fallback |
| `POLL_INTERVAL_MS` | No | `15000` | Polling interval in milliseconds |
| `CLASSIFICATION_CONFIDENCE_THRESHOLD` | No | `0.6` | Min confidence for local ML (0-1) |
| `MAX_ERROR_LOGS` | No | `1000` | Max error log entries before purge |
| `DB_PATH` | No | `./data/todoist.db` | SQLite database path |
| `LOG_LEVEL` | No | `info` | Log level (debug, info, warn, error) |

## Classification Behavior

### Local ML Classification
- Uses DistilBERT model (~400MB download on first run)
- Zero-shot classification - no training needed
- Scores each label against task content
- Labels above confidence threshold are applied

### Claude Haiku Fallback
- Triggered when local ML confidence is below threshold
- Triggered when local ML fails
- Requires `ANTHROPIC_API_KEY` to be set
- Falls back gracefully if API credits are exhausted

### Retry Logic
- Failed classifications are retried on subsequent poll cycles
- Maximum 3 attempts per task
- Errors are logged to SQLite for debugging

## Troubleshooting

### "TODOIST_API_TOKEN environment variable is not set"
Ensure your `.env` file exists and contains the token.

### Model download fails
Check your internet connection. The model is cached after first download.

### Tasks not being classified
1. Ensure tasks are in your Inbox (other projects are ignored)
2. Check the confidence threshold isn't too high
3. View logs: `npm run pm2:logs`

### Database locked errors
Only one instance of the service should run. Stop any existing instances:
```bash
npm run pm2:stop
```

## Next Steps

See [deployment.md](./deployment.md) for instructions on running the service with PM2.

