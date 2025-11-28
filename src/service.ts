/**
 * Main service entry point for the Todoist autolabel service
 * Orchestrates the sync loop, classification, and label application
 */

import { loadConfig, validateConfig, getConfig } from './config.js';
import { initDatabase, closeDatabase, getUnclassifiedTasks, markTaskClassified, markTaskFailed, purgeErrorLogsIfNeeded } from './database.js';
import { logger } from './logger.js';
import { performIncrementalSync } from './sync.js';
import { initClassifier, classifyTasks, isClassifierReady } from './classifier.js';
import { applyClassificationResults } from './todoist-api.js';
import type { TaskToClassify, ClassificationRequest } from './types.js';

// Service state
let isRunning = false;
let pollTimeoutId: NodeJS.Timeout | null = null;

/**
 * Process tasks that need classification
 */
async function processClassificationQueue(tasks: TaskToClassify[]): Promise<void> {
  if (tasks.length === 0) {
    return;
  }
  
  // Convert to classification requests
  const requests: ClassificationRequest[] = tasks.map(task => ({
    taskId: task.id,
    content: task.content,
    description: task.description,
    existingLabels: task.existingLabels,
  }));
  
  // Classify tasks
  const classificationResults = await classifyTasks(requests);
  
  // Apply results to Todoist
  const processingResults = await applyClassificationResults(classificationResults);
  
  // Update database based on results
  for (const result of processingResults) {
    if (result.success) {
      markTaskClassified(result.taskId, result.labelsApplied || []);
    } else {
      markTaskFailed(result.taskId, result.error || 'Unknown error');
    }
  }
}

/**
 * Main polling loop iteration
 */
async function pollIteration(): Promise<void> {
  try {
    // Perform incremental sync
    const syncResult = await performIncrementalSync();
    
    // Get any unclassified tasks from database (includes failed retries)
    const dbUnclassifiedTasks = getUnclassifiedTasks();
    
    // Combine new tasks from sync with unclassified from database
    const allTasksToClassify: TaskToClassify[] = [...syncResult.newTasks];
    
    // Add database tasks that aren't already in the sync result
    const syncTaskIds = new Set(syncResult.newTasks.map(t => t.id));
    for (const dbTask of dbUnclassifiedTasks) {
      if (!syncTaskIds.has(dbTask.id)) {
        allTasksToClassify.push({
          id: dbTask.id,
          content: dbTask.content,
          description: '',
          existingLabels: JSON.parse(dbTask.labels) as string[],
        });
      }
    }
    
    // Process classification queue
    await processClassificationQueue(allTasksToClassify);
    
    // Periodically purge old error logs
    purgeErrorLogsIfNeeded();
    
  } catch (error) {
    logger.exception('Poll iteration failed', error);
  }
}

/**
 * Schedule the next poll iteration
 */
function scheduleNextPoll(): void {
  if (!isRunning) {
    return;
  }
  
  const config = getConfig();
  
  pollTimeoutId = setTimeout(async () => {
    await pollIteration();
    scheduleNextPoll();
  }, config.pollIntervalMs);
}

/**
 * Start the service
 */
export async function startService(): Promise<void> {
  if (isRunning) {
    logger.warn('Service is already running');
    return;
  }
  
  logger.service.starting();
  
  try {
    // Load and validate configuration
    loadConfig();
    validateConfig();
    const config = getConfig();
    
    // Initialize database
    initDatabase();
    logger.info('Database initialized');
    
    // Initialize classifier
    await initClassifier();
    
    // Start polling
    isRunning = true;
    logger.service.started({ pollInterval: config.pollIntervalMs });
    
    // Run first iteration immediately
    await pollIteration();
    
    // Schedule subsequent polls
    scheduleNextPoll();
    
  } catch (error) {
    logger.exception('Failed to start service', error);
    await stopService();
    throw error;
  }
}

/**
 * Stop the service gracefully
 */
export async function stopService(): Promise<void> {
  logger.service.stopping();
  
  isRunning = false;
  
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
  
  closeDatabase();
  
  logger.service.stopped();
}

/**
 * Get service status
 */
export function getServiceStatus(): {
  isRunning: boolean;
  classifierReady: boolean;
} {
  return {
    isRunning,
    classifierReady: isClassifierReady(),
  };
}

// Handle graceful shutdown
function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);
    await stopService();
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  process.on('uncaughtException', (error) => {
    logger.exception('Uncaught exception', error);
    stopService().then(() => process.exit(1));
  });
  
  process.on('unhandledRejection', (reason) => {
    logger.exception('Unhandled rejection', reason);
  });
}

// Main execution
async function main(): Promise<void> {
  setupShutdownHandlers();
  
  try {
    await startService();
  } catch (error) {
    logger.exception('Service failed to start', error);
    process.exit(1);
  }
}

// Run if executed directly
main();

