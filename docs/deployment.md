# Deployment Guide

This guide covers deploying and managing the Todoist Autolabel Service on your Mac Mini using PM2.

## Prerequisites

Complete the [setup guide](./setup.md) first.

## PM2 Overview

PM2 is a production process manager for Node.js that provides:
- Automatic restarts on crash
- Log management
- Startup script generation
- Resource monitoring

## Starting the Service

### Build First

Always build before deploying:

```bash
pnpm run build
```

### Start with PM2

```bash
pnpm run pm2:start
```

This starts the service using the configuration in `ecosystem.config.cjs`.

### Verify It's Running

```bash
pnpm run pm2:status
```

You should see output like:
```
┌─────┬───────────────────┬─────────────┬─────────┬─────────┬──────────┐
│ id  │ name              │ namespace   │ version │ mode    │ pid      │
├─────┼───────────────────┼─────────────┼─────────┼─────────┼──────────┤
│ 0   │ todoist-autolabel │ default     │ 1.0.0   │ fork    │ 12345    │
└─────┴───────────────────┴─────────────┴─────────┴─────────┴──────────┘
```

## Viewing Logs

### Real-time Logs

```bash
pnpm run pm2:logs
```

### Log Files

PM2 stores logs in the `logs/` directory:
- `pm2-out.log` - Standard output
- `pm2-error.log` - Error output
- `pm2-combined.log` - Combined logs

### View Specific Log File

```bash
tail -f logs/pm2-out.log
```

## Managing the Service

### Stop

```bash
pnpm run pm2:stop
```

### Restart

```bash
pnpm run pm2:restart
```

### Delete from PM2

```bash
pm2 delete todoist-autolabel
```

## Auto-Start on Boot

To have the service start automatically when your Mac Mini reboots:

### 1. Generate Startup Script

```bash
pm2 startup
```

PM2 will output a command - run it exactly as shown.

### 2. Save Current Process List

After starting your service:

```bash
pm2 save
```

### 3. Test It

Reboot your Mac Mini and verify the service starts automatically:

```bash
ppnpm run pm2:status
```

## PM2 Configuration

The service is configured in `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: 'todoist-autolabel',
      script: 'dist/service.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      time: true,
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `name` | Process name in PM2 |
| `script` | Entry point (compiled JS) |
| `instances` | Number of instances (keep at 1) |
| `autorestart` | Restart on crash |
| `max_memory_restart` | Restart if memory exceeds this |
| `exp_backoff_restart_delay` | Delay between restart attempts |
| `max_restarts` | Max restarts in time window |
| `min_uptime` | Min time to consider "started" |

## Monitoring

### PM2 Monit

Real-time monitoring dashboard:

```bash
pm2 monit
```

### PM2 Plus (Optional)

For web-based monitoring, sign up at [PM2.io](https://pm2.io/):

```bash
pm2 link <secret> <public>
```

## Updating the Service

### 1. Pull Latest Code

```bash
git pull origin main
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Rebuild

```bash
ppnpm run build
```

### 4. Restart Service

```bash
ppnpm run pm2:restart
```

## Database Management

### Location

The SQLite database is stored at the path specified in `DB_PATH` (default: `./data/todoist.db`).

### Backup

```bash
cp data/todoist.db data/todoist.db.backup
```

### Reset (Full Resync)

To force a full resync:

1. Stop the service
2. Delete the database
3. Start the service

```bash
pnpm run pm2:stop
rm data/todoist.db
pnpm run pm2:start
```

### View Error Logs in Database

```bash
sqlite3 data/todoist.db "SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT 20;"
```

### View Classification History

```bash
sqlite3 data/todoist.db "SELECT id, content, classified, labels FROM tasks ORDER BY created_at DESC LIMIT 20;"
```

## Troubleshooting

### Service Keeps Restarting

Check the logs for errors:

```bash
pnpm run pm2:logs --lines 100
```

Common causes:
- Missing environment variables
- Invalid API tokens
- Network connectivity issues

### Memory Usage

The service uses minimal memory (~50-100MB) since classification is done via API calls. If memory issues occur:

1. Check for memory leaks in logs
2. Restart the service: `ppnpm run pm2:restart`

### Service Not Starting on Boot

1. Verify startup script was installed:
   ```bash
   pm2 startup
   ```

2. Resave process list:
   ```bash
   pm2 save
   ```

### API Rate Limiting

If you see rate limit errors:

1. Increase `POLL_INTERVAL_MS` in `.env`
2. The service has built-in 200ms delays between API calls

### Claude API Errors

Common Claude API issues:

| Error | Solution |
|-------|----------|
| `credit` / `billing` | Add credits to your Anthropic account |
| `rate_limit` | Increase poll interval or wait |
| `invalid_api_key` | Check your `ANTHROPIC_API_KEY` |

## Security Notes

### API Tokens

- Never commit `.env` to version control
- Rotate tokens periodically
- Use minimal permissions

### Database

- The SQLite database contains task metadata
- Back up regularly if needed
- Delete old data with the built-in FIFO purge

## Useful PM2 Commands

```bash
# List all processes
pm2 list

# Show detailed process info
pm2 show todoist-autolabel

# Clear all logs
pm2 flush

# Reset restart counter
pm2 reset todoist-autolabel

# View ecosystem config
pm2 ecosystem
```

## Cost Estimation

With Claude Haiku at ~$0.25 per million tokens:

| Tasks/Day | Est. Monthly Cost |
|-----------|-------------------|
| 10 | < $0.01 |
| 100 | ~$0.05 |
| 1000 | ~$0.50 |

The service is very cost-effective for typical personal use.
