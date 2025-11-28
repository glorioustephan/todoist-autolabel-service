/**
 * Structured logging module for the Todoist autolabel service
 * Logs to console and stores errors in SQLite database
 */

import { getConfig } from './config.js';
import { insertErrorLog, purgeErrorLogsIfNeeded } from './database.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS = {
  debug: '\x1b[90m', // Gray
  info: '\x1b[36m',  // Cyan
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
  reset: '\x1b[0m',
};

const LOG_ICONS = {
  debug: '🔍',
  info: 'ℹ️ ',
  warn: '⚠️ ',
  error: '❌',
};

function shouldLog(level: LogLevel): boolean {
  const config = getConfig();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[config.logLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): string {
  const timestamp = formatTimestamp();
  const icon = LOG_ICONS[level];
  const color = LOG_COLORS[level];
  const reset = LOG_COLORS.reset;
  
  let formatted = `${color}[${timestamp}] ${icon} ${level.toUpperCase()}${reset}: ${message}`;
  
  if (context && Object.keys(context).length > 0) {
    formatted += ` ${JSON.stringify(context)}`;
  }
  
  return formatted;
}

function logToConsole(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  if (!shouldLog(level)) {
    return;
  }
  
  const formatted = formatMessage(level, message, context);
  
  switch (level) {
    case 'error':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

function logToDatabase(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void {
  // Only store warn and error levels in the database
  if (LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY.warn) {
    try {
      insertErrorLog(level, message, context);
      // Periodically check and purge old logs
      purgeErrorLogsIfNeeded();
    } catch (err) {
      // Don't let database errors crash the logger
      console.error('Failed to log to database:', err);
    }
  }
}

/**
 * Logger interface for the service
 */
export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    logToConsole('debug', message, context);
  },

  info(message: string, context?: Record<string, unknown>): void {
    logToConsole('info', message, context);
  },

  warn(message: string, context?: Record<string, unknown>): void {
    logToConsole('warn', message, context);
    logToDatabase('warn', message, context);
  },

  error(message: string, context?: Record<string, unknown>): void {
    logToConsole('error', message, context);
    logToDatabase('error', message, context);
  },

  /**
   * Log an error with full stack trace
   */
  exception(message: string, error: unknown, context?: Record<string, unknown>): void {
    const errorDetails = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) };
    
    const fullContext = { ...context, error: errorDetails };
    
    logToConsole('error', message, fullContext);
    logToDatabase('error', message, fullContext);
  },

  /**
   * Log service lifecycle events
   */
  service: {
    starting(): void {
      logger.info('🚀 Service starting...');
    },

    started(config: { pollInterval: number }): void {
      logger.info(`✅ Service started - polling every ${config.pollInterval}ms`);
    },

    stopping(): void {
      logger.info('🛑 Service stopping...');
    },

    stopped(): void {
      logger.info('✅ Service stopped');
    },
  },

  /**
   * Log sync events
   */
  sync: {
    starting(syncToken: string): void {
      const isFullSync = syncToken === '*';
      logger.debug(`Sync starting (${isFullSync ? 'full sync' : 'incremental'})`, { syncToken: syncToken.substring(0, 20) + '...' });
    },

    completed(taskCount: number, isFullSync: boolean): void {
      logger.info(`Sync completed`, { taskCount, isFullSync });
    },

    noChanges(): void {
      logger.debug('Sync completed - no new tasks');
    },

    failed(error: unknown): void {
      logger.exception('Sync failed', error);
    },
  },

  /**
   * Log classification events
   */
  classification: {
    starting(taskCount: number): void {
      logger.info(`Classification starting for ${taskCount} task(s)`);
    },

    taskClassified(taskId: string, labels: string[], source: 'local' | 'fallback', confidence?: number): void {
      logger.info(`Task classified`, { taskId, labels, source, confidence });
    },

    taskFailed(taskId: string, error: unknown): void {
      logger.exception(`Task classification failed`, error, { taskId });
    },

    fallbackTriggered(taskId: string, reason: string): void {
      logger.info(`Fallback classification triggered`, { taskId, reason });
    },

    fallbackFailed(taskId: string, error: unknown): void {
      logger.exception(`Fallback classification failed - task will be retried`, error, { taskId });
    },

    completed(total: number, successful: number, failed: number): void {
      logger.info(`Classification completed`, { total, successful, failed });
    },
  },

  /**
   * Log Todoist API events
   */
  todoist: {
    updating(taskId: string, labels: string[]): void {
      logger.debug(`Updating task labels`, { taskId, labels });
    },

    updated(taskId: string): void {
      logger.info(`Task labels updated`, { taskId });
    },

    updateFailed(taskId: string, error: unknown): void {
      logger.exception(`Failed to update task labels`, error, { taskId });
    },
  },
};

export default logger;

