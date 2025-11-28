/**
 * Main entry point for Todoist Autolabel Service
 */

import { loadConfig, getConfig } from './config.js';
import { createLogger, getLogger } from './logger.js';
import { initDatabase, closeDatabase, getDatabase } from './database.js';
import { initTodoistApi } from './todoist-api.js';
import { initClassifier } from './classifier.js';
import { initSyncManager, getSyncManager } from './sync.js';

// Track if service is shutting down
let isShuttingDown = false;
let syncInterval: NodeJS.Timeout | null = null;

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
  const classifier = initClassifier(config);
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
 * Stop the sync loop
 */
function stopSyncLoop(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
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

  // Stop the sync loop
  stopSyncLoop();

  // Close database
  try {
    closeDatabase();
    logger.info('Database closed');
  } catch (error) {
    logger.error('Error closing database', error);
  }

  logger.info('Service shutdown complete');
  process.exit(0);
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
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Initialize all components
    await initialize();

    const logger = getLogger();

    // Set up signal handlers for graceful shutdown
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', reason as Error);
      // Don't shutdown on unhandled rejection - just log it
    });

    // Print initial stats
    printStats();

    // Start the main sync loop
    startSyncLoop();

    logger.info('Todoist Autolabel Service is running');
    logger.info('Press Ctrl+C to stop');
  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
}

// Run the service
main();

