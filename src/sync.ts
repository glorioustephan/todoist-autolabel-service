/**
 * Sync orchestration for Todoist Autolabel Service
 */

import type { Config, TodoistTask } from './types.js';
import { getLogger } from './logger.js';
import { getDatabase } from './database.js';
import { getTodoistApi } from './todoist-api.js';
import { getClassifier } from './classifier.js';

// Maximum retry attempts per task
const MAX_ATTEMPTS = 3;

/**
 * Sync manager for orchestrating the classification process
 */
export class SyncManager {
  private isRunning: boolean = false;
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Perform a single sync cycle
   */
  async sync(): Promise<{
    processed: number;
    classified: number;
    failed: number;
    skipped: number;
  }> {
    const logger = getLogger();
    const db = getDatabase();
    const api = getTodoistApi();

    const stats = {
      processed: 0,
      classified: 0,
      failed: 0,
      skipped: 0,
    };

    if (this.isRunning) {
      logger.debug('Sync already in progress, skipping');
      return stats;
    }

    this.isRunning = true;

    try {
      logger.debug('Starting sync cycle');

      // Get all inbox tasks
      const tasksResult = await api.getInboxTasks();
      if (!tasksResult.success) {
        logger.error('Failed to get inbox tasks', new Error(tasksResult.error));
        return { processed: 0, classified: 0, failed: 0, skipped: 0 };
      }

      const tasks = tasksResult.data;
      logger.info(`Found ${tasks.length} tasks in Inbox`);

      // Filter to tasks that need classification
      const tasksToProcess = tasks.filter((task: TodoistTask) => {
        // Skip completed tasks
        if (task.isCompleted) {
          return false;
        }

        // Skip tasks that already have labels
        if (task.labels && task.labels.length > 0) {
          // Update database to mark as skipped if not already tracked
          const existing = db.getTask(task.id);
          if (!existing.success) {
            db.upsertTask(task.id, task.content);
            db.markTaskSkipped(task.id);
          }
          return false;
        }

        // Check database state
        const taskRecord = db.getTask(task.id);
        if (taskRecord.success) {
          // Skip if already classified or permanently failed
          if (taskRecord.data.status === 'classified' || taskRecord.data.status === 'skipped') {
            return false;
          }
          // Skip if max attempts reached
          if (taskRecord.data.status === 'failed' || taskRecord.data.attempts >= MAX_ATTEMPTS) {
            return false;
          }
        }

        return true;
      });

      logger.info(`${tasksToProcess.length} tasks need classification`);

      // Process each task
      for (const task of tasksToProcess) {
        stats.processed++;

        try {
          const result = await this.processTask(task);

          if (result.success) {
            stats.classified++;
          } else if (result.skipped) {
            stats.skipped++;
          } else {
            stats.failed++;
          }
        } catch (error) {
          stats.failed++;
          logger.error('Error processing task', error, { taskId: task.id });
        }
      }

      // Update last sync time
      db.saveLastSyncAt();

      logger.info('Sync cycle completed', stats);
      return stats;
    } catch (error) {
      logger.error('Sync cycle failed', error);
      db.logError(
        'SYNC_ERROR',
        error instanceof Error ? error.message : String(error),
        undefined,
        error instanceof Error ? error.stack : undefined
      );
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Reconcile DB state with the live Inbox.
   *
   * Looks at every Inbox task that is currently unlabelled and incomplete,
   * and resets any DB record that is in a terminal-retry state
   * (`status='failed'` or `attempts >= MAX_ATTEMPTS`) so the regular sync
   * cycle will pick it up again. Resets are gated by `backfillCooldownMs`
   * so a genuinely-unclassifiable task settles into a slow retry cadence
   * instead of consuming classifier calls on every tick.
   *
   * Returns the number of DB rows actually reset.
   */
  async reconcile(): Promise<{ reset: number; inboxSize: number }> {
    const logger = getLogger();
    const db = getDatabase();
    const api = getTodoistApi();

    logger.debug('Starting reconciliation pass');

    const tasksResult = await api.getInboxTasks();
    if (!tasksResult.success) {
      logger.error(
        'Reconciliation aborted: could not fetch Inbox',
        new Error(tasksResult.error)
      );
      return { reset: 0, inboxSize: 0 };
    }

    const inboxTasks = tasksResult.data;
    const eligibleIds = inboxTasks
      .filter((t) => !t.isCompleted && (!t.labels || t.labels.length === 0))
      .map((t) => t.id);

    if (eligibleIds.length === 0) {
      logger.debug('Reconciliation: no eligible Inbox tasks');
      return { reset: 0, inboxSize: inboxTasks.length };
    }

    const reset = db.resetFailedTasksForRetry(eligibleIds, this.config.backfillCooldownMs);

    if (reset > 0) {
      logger.info(`Reconciliation reset ${reset} previously-failed task(s) for retry`);
    } else {
      logger.debug('Reconciliation: nothing to reset');
    }

    return { reset, inboxSize: inboxTasks.length };
  }

  /**
   * Process a single task
   */
  private async processTask(
    task: TodoistTask
  ): Promise<{ success: boolean; skipped: boolean }> {
    const logger = getLogger();
    const db = getDatabase();
    const api = getTodoistApi();
    const classifier = getClassifier();

    // Ensure task is in database
    db.upsertTask(task.id, task.content);

    // Get current task record
    const taskRecordResult = db.getTask(task.id);
    const attempts = taskRecordResult.success ? taskRecordResult.data.attempts : 0;

    logger.debug('Processing task', {
      taskId: task.id,
      content: task.content,
      attempts,
    });

    try {
      // Classify the task
      const result = await classifier.classifyTask({
        taskId: task.id,
        content: task.content,
        description: task.description,
        availableLabels: classifier.getAvailableLabels(),
      });

      if (!result.success) {
        logger.error('Classification failed', new Error(result.error), { taskId: task.id });
        
        // Increment attempt counter after failure
        db.markTaskAttempted(task.id);

        // Check if max attempts reached
        if (attempts + 1 >= MAX_ATTEMPTS) {
          db.markTaskFailed(task.id);
          db.logError('CLASSIFICATION_FAILED', result.error, task.id);
          return { success: false, skipped: false };
        }
        return { success: false, skipped: false };
      }

      if (result.data.labels.length === 0) {
        logger.warn('No labels assigned to task', { taskId: task.id });

        // Increment attempt counter after no labels returned
        db.markTaskAttempted(task.id);

        // Check if max attempts reached
        if (attempts + 1 >= MAX_ATTEMPTS) {
          db.markTaskFailed(task.id);
          db.logError(
            'CLASSIFICATION_EMPTY',
            'No labels could be assigned after max attempts',
            task.id
          );
          return { success: false, skipped: false };
        }

        return { success: false, skipped: false };
      }

      // Apply labels to task in Todoist
      // This must succeed before we mark as classified in the database
      await api.updateTaskLabels(task.id, [...result.data.labels]);

      // Only mark as classified in database after BOTH APIs succeeded
      db.markTaskClassified(task.id, [...result.data.labels]);

      logger.success('Task classified', {
        taskId: task.id,
        labels: result.data.labels,
      });

      return { success: true, skipped: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Increment attempt counter after exception
      db.markTaskAttempted(task.id);

      // Log error to database
      db.logError(
        'CLASSIFICATION_ERROR',
        errorMessage,
        task.id,
        error instanceof Error ? error.stack : undefined
      );

      // Check if max attempts reached
      if (attempts + 1 >= MAX_ATTEMPTS) {
        db.markTaskFailed(task.id);
        logger.error('Task classification permanently failed', error, {
          taskId: task.id,
          attempts: attempts + 1,
        });
      } else {
        logger.warn('Task classification failed, will retry', {
          taskId: task.id,
          attempts: attempts + 1,
          error: errorMessage,
        });
      }

      return { success: false, skipped: false };
    }
  }

  /**
   * Retry failed tasks that haven't reached max attempts
   */
  async retryFailedTasks(): Promise<number> {
    const logger = getLogger();
    const db = getDatabase();

    const pendingTasks = db.getPendingRetryableTasks();
    logger.info(`Found ${pendingTasks.length} tasks to retry`);

    let retried = 0;
    const api = getTodoistApi();

    for (const taskRecord of pendingTasks) {
      try {
        // Fetch current task from Todoist
        const task = await api.getTask(taskRecord.taskId);

        if (!task) {
          // Task was deleted
          db.markTaskSkipped(taskRecord.taskId);
          continue;
        }

        // Skip if task now has labels
        if (task.labels && task.labels.length > 0) {
          db.markTaskSkipped(taskRecord.taskId);
          continue;
        }

        const result = await this.processTask(task);
        if (result.success) {
          retried++;
        }
      } catch (error) {
        logger.error('Error retrying task', error, { taskId: taskRecord.taskId });
      }
    }

    return retried;
  }
}

/**
 * Singleton sync manager instance
 */
let syncInstance: SyncManager | null = null;

/**
 * Initialize the sync manager
 */
export function initSyncManager(config: Config): SyncManager {
  if (!syncInstance) {
    syncInstance = new SyncManager(config);
  }
  return syncInstance;
}

/**
 * Get the sync manager instance
 */
export function getSyncManager(): SyncManager {
  if (!syncInstance) {
    throw new Error('Sync manager not initialized. Call initSyncManager first.');
  }
  return syncInstance;
}

/**
 * Reset the sync manager instance (for testing)
 */
export function resetSyncManager(): void {
  syncInstance = null;
}

