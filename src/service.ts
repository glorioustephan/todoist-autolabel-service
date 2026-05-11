#!/usr/bin/env node
/**
 * Main entry point for Todoist Autolabel Service
 *
 * Wired up as the package `bin` so consumers can run `npx todoist-autolabel`
 * from any directory; configuration is loaded from the CWD's `.env`.
 */

import { readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { loadConfig, getConfig } from './config.js';
import { createLogger, getLogger } from './logger.js';
import { initDatabase, closeDatabase, getDatabase } from './database.js';
import { initTodoistApi } from './todoist-api.js';
import { initClassifier } from './classifier.js';
import { initSyncManager, getSyncManager } from './sync.js';

// Track if service is shutting down
let isShuttingDown = false;
let syncInterval: NodeJS.Timeout | null = null;
let reconcileInterval: NodeJS.Timeout | null = null;

/**
 * Initialize all service components
 */
async function initialize(): Promise<void> {
  // Load configuration first
  const config = loadConfig();

  // Initialize logger with configured level
  const logger = createLogger(config.logLevel);

  logger.info('Initializing Todoist Autolabel Service');
  logger.info('Configuration loaded', {
    model: config.anthropicModel,
    pollInterval: config.pollIntervalMs,
    maxLabelsPerTask: config.maxLabelsPerTask,
    logLevel: config.logLevel,
  });

  // Initialize database
  logger.info('Initializing database', { path: config.dbPath });
  initDatabase(config);

  // Initialize Todoist API
  logger.info('Connecting to Todoist API');
  await initTodoistApi(config);

  // Initialize classifier
  logger.info('Initializing Claude classifier', { model: config.anthropicModel });
  const classifierResult = await initClassifier(config);
  if (!classifierResult.success) {
    throw new Error(`Failed to initialize classifier: ${classifierResult.error}`);
  }
  const classifier = classifierResult.data;
  logger.info(`Loaded ${classifier.getAvailableLabels().length} labels`);

  // Initialize sync manager
  initSyncManager(config);

  logger.success('Service initialization complete');
}

/**
 * Run a single sync cycle
 */
async function runSyncCycle(): Promise<void> {
  const logger = getLogger();

  if (isShuttingDown) {
    logger.debug('Skipping sync cycle - service is shutting down');
    return;
  }

  try {
    const syncManager = getSyncManager();
    await syncManager.sync();
  } catch (error) {
    logger.error('Sync cycle error', error);
    // Don't throw - let the service continue running
  }
}

/**
 * Start the sync loop
 */
function startSyncLoop(): void {
  const config = getConfig();
  const logger = getLogger();

  logger.info(`Starting sync loop (interval: ${config.pollIntervalMs}ms)`);

  // Run immediately on start
  runSyncCycle();

  // Then run on interval
  syncInterval = setInterval(() => {
    runSyncCycle();
  }, config.pollIntervalMs);
}

/**
 * Run a reconciliation pass that resets previously-failed Inbox tasks so
 * the regular sync loop will pick them up again. Safe to call any number
 * of times: per-task retries are rate-limited by `backfillCooldownMs`.
 */
async function runReconciliation(reason: 'startup' | 'periodic'): Promise<void> {
  const logger = getLogger();

  if (isShuttingDown) {
    logger.debug(`Skipping ${reason} reconciliation - service is shutting down`);
    return;
  }

  try {
    const syncManager = getSyncManager();
    await syncManager.reconcile();
  } catch (error) {
    logger.error(`${reason} reconciliation error`, error);
    // Don't throw - never let the recovery path take the service down.
  }
}

/**
 * Start the periodic reconciliation timer (separate cadence from the sync
 * loop, default 24h). A `backfillIntervalMs` of 0 disables it.
 */
function startReconciliationLoop(): void {
  const config = getConfig();
  const logger = getLogger();

  if (config.backfillIntervalMs <= 0) {
    logger.debug('Periodic reconciliation disabled (BACKFILL_INTERVAL_MS=0)');
    return;
  }

  logger.info(
    `Starting reconciliation loop (interval: ${config.backfillIntervalMs}ms, cooldown: ${config.backfillCooldownMs}ms)`
  );

  reconcileInterval = setInterval(() => {
    runReconciliation('periodic');
  }, config.backfillIntervalMs);
}

/**
 * Stop the sync loop
 */
function stopSyncLoop(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * Stop the reconciliation loop
 */
function stopReconciliationLoop(): void {
  if (reconcileInterval) {
    clearInterval(reconcileInterval);
    reconcileInterval = null;
  }
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  const logger = getLogger();

  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully`);

  // Stop both timers
  stopSyncLoop();
  stopReconciliationLoop();

  // Close database
  try {
    closeDatabase();
    logger.info('Database closed');
  } catch (error) {
    logger.error('Error closing database', error);
  }

  logger.info('Service shutdown complete');

  // Let the process exit naturally instead of forcing it
  // This allows any cleanup handlers to run properly
}

/**
 * Print service stats
 */
function printStats(): void {
  const logger = getLogger();
  const db = getDatabase();
  const stats = db.getStats();
  const syncState = db.getSyncState();

  logger.info('Service Statistics', {
    totalTasks: stats.total,
    classified: stats.classified,
    failed: stats.failed,
    pending: stats.pending,
    skipped: stats.skipped,
    lastSync: syncState.lastSyncAt,
  });
}

/**
 * Resolve a file shipped alongside this module (e.g. `labels.example.json`).
 * Inside the published package, templates sit one directory up from `dist/`.
 */
function packageFile(...segments: string[]): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', ...segments);
}

const HELP = `todoist-autolabel — auto-classify Todoist Inbox tasks with Claude AI

USAGE
  todoist-autolabel [options]
  todoist-autolabel init [--force]

COMMANDS
  init                   Scaffold .env and labels.json in the current
                         directory from the bundled templates.

OPTIONS
  -l, --labels <path>    Path to your labels file
                         (default: ./labels.json, or LABELS_PATH env var)
  -h, --help             Show this help and exit
  -v, --version          Print the package version and exit

ENVIRONMENT
  TODOIST_API_TOKEN      Required. Todoist API token.
  ANTHROPIC_API_KEY      Required. Anthropic API key.
  ANTHROPIC_MODEL        Claude model (default: claude-haiku-4-5-20251001).
  LABELS_PATH            Override the labels file location.
  DB_PATH                SQLite database path (default: ./data/todoist.db).
  POLL_INTERVAL_MS       Polling interval (default: 15000).
  LOG_LEVEL              debug | info | warn | error (default: info).

Full reference: https://github.com/glorioustephan/todoist-autolabel-service#readme
`;

/**
 * Copy a single template into the consumer's CWD without clobbering existing
 * user state unless `--force` is passed.
 */
async function copyTemplate(
  source: string,
  destination: string,
  force: boolean
): Promise<'created' | 'skipped' | 'overwritten'> {
  try {
    await fs.access(destination);
    if (!force) return 'skipped';
    await fs.copyFile(source, destination);
    return 'overwritten';
  } catch {
    await fs.copyFile(source, destination);
    return 'created';
  }
}

/**
 * `init` subcommand: scaffold .env and labels.json in CWD.
 */
async function runInit(force: boolean): Promise<void> {
  const targets: { from: string; to: string; label: string }[] = [
    {
      from: packageFile('env.example'),
      to: path.resolve(process.cwd(), '.env'),
      label: '.env',
    },
    {
      from: packageFile('labels.example.json'),
      to: path.resolve(process.cwd(), 'labels.json'),
      label: 'labels.json',
    },
  ];

  for (const { from, to, label } of targets) {
    try {
      const result = await copyTemplate(from, to, force);
      if (result === 'skipped') {
        console.log(`✓ ${label} already exists — left untouched (pass --force to overwrite)`);
      } else if (result === 'overwritten') {
        console.log(`✓ ${label} overwritten from template`);
      } else {
        console.log(`✓ ${label} created from template`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ Failed to create ${label}: ${message}`);
      process.exit(1);
    }
  }

  console.log('\nNext steps:');
  console.log('  1. Open .env and fill in TODOIST_API_TOKEN and ANTHROPIC_API_KEY.');
  console.log('  2. Adjust labels.json to match your Todoist label taxonomy.');
  console.log('  3. Run: npx todoist-autolabel');
}

/**
 * Parse CLI arguments and apply overrides to the environment so that the
 * existing config loader (which is purely env-driven) picks them up.
 *
 * Returns the resolved subcommand the rest of `main()` should run.
 */
function parseCliArgs(): { command: 'run' | 'init'; force: boolean } {
  const positionals = process.argv.slice(2);

  // Cheap pre-scan for `init` to avoid `parseArgs` swallowing it as a flag.
  if (positionals[0] === 'init') {
    const force = positionals.includes('--force') || positionals.includes('-f');
    return { command: 'init', force };
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      options: {
        labels: { type: 'string', short: 'l' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${message}\n`);
    console.error(HELP);
    process.exit(2);
  }

  const values = parsed.values;

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (values.version) {
    const pkg = JSON.parse(
      readFileSync(packageFile('package.json'), 'utf-8')
    ) as { version: string };
    console.log(pkg.version);
    process.exit(0);
  }

  if (typeof values.labels === 'string') {
    // Override before loadConfig() runs so the env-driven loader picks it up.
    process.env.LABELS_PATH = path.resolve(process.cwd(), values.labels);
  }

  return { command: 'run', force: false };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { command, force } = parseCliArgs();

  if (command === 'init') {
    await runInit(force);
    return;
  }

  try {
    // Initialize all components
    await initialize();

    const logger = getLogger();

    // Set up signal handlers for graceful shutdown
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception', error);
      await shutdown('uncaughtException');
      process.exit(1); // Force exit for uncaught exceptions
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', reason as Error);
      // Don't shutdown on unhandled rejection - just log it
    });

    // Print initial stats
    printStats();

    // If configured, reset previously-failed Inbox tasks before the first
    // sync cycle so they get re-classified on this boot (default: true).
    const config = getConfig();
    if (config.backfillOnStart) {
      logger.info('Running startup backfill of previously-failed Inbox tasks');
      await runReconciliation('startup');
    } else {
      logger.debug('Startup backfill disabled (BACKFILL_ON_START=false)');
    }

    // Start the main sync loop
    startSyncLoop();

    // Schedule the periodic reconciliation sweep (no-op if interval is 0).
    startReconciliationLoop();

    logger.info('Todoist Autolabel Service is running');
    logger.info('Press Ctrl+C to stop');
  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
}

// Run the service
main();

