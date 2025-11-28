/**
 * Colorful logging utility for Todoist Autolabel Service
 */

import chalk from 'chalk';
import type { LogLevel } from './types.js';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Color configuration for each log level
 */
const LEVEL_COLORS = {
  debug: chalk.gray,
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red.bold,
};

/**
 * Format a timestamp for log output
 */
function formatTimestamp(): string {
  return chalk.dim(new Date().toISOString());
}

/**
 * Format the log level badge
 */
function formatLevel(level: LogLevel): string {
  const color = LEVEL_COLORS[level];
  const badge = level.toUpperCase().padEnd(5);
  return color(badge);
}

/**
 * Format metadata object
 */
function formatMeta(meta: Record<string, unknown>): string {
  if (Object.keys(meta).length === 0) return '';
  
  const formatted = Object.entries(meta)
    .map(([key, value]) => {
      const formattedKey = chalk.dim(`${key}=`);
      const formattedValue = typeof value === 'string' 
        ? chalk.green(`"${value}"`)
        : chalk.magenta(JSON.stringify(value));
      return `${formattedKey}${formattedValue}`;
    })
    .join(' ');
  
  return ` ${formatted}`;
}

/**
 * Format a log message with colors
 */
function formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const timestamp = formatTimestamp();
  const levelBadge = formatLevel(level);
  const messageColor = level === 'error' ? chalk.red : level === 'warn' ? chalk.yellow : chalk.white;
  const formattedMessage = messageColor(message);
  const metaStr = meta ? formatMeta(meta) : '';
  
  return `${timestamp} ${levelBadge} ${formattedMessage}${metaStr}`;
}

/**
 * Logger class with configurable log levels and colorful output
 */
export class Logger {
  private level: LogLevel;
  private levelValue: number;

  constructor(level: LogLevel = 'info') {
    this.level = level;
    this.levelValue = LOG_LEVELS[level];
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.levelValue;
  }

  /**
   * Log a debug message
   */
  debug(message: string, meta: Record<string, unknown> = {}): void {
    if (this.shouldLog('debug')) {
      console.log(formatMessage('debug', message, meta));
    }
  }

  /**
   * Log an info message
   */
  info(message: string, meta: Record<string, unknown> = {}): void {
    if (this.shouldLog('info')) {
      console.log(formatMessage('info', message, meta));
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, meta: Record<string, unknown> = {}): void {
    if (this.shouldLog('warn')) {
      console.warn(formatMessage('warn', message, meta));
    }
  }

  /**
   * Log an error message with optional error object and metadata
   */
  error(message: string, error?: Error | unknown, meta: Record<string, unknown> = {}): void {
    if (!this.shouldLog('error')) return;

    const errorMeta: Record<string, unknown> = { ...meta };

    if (error instanceof Error) {
      errorMeta.errorMessage = error.message;
      errorMeta.errorName = error.name;
      if (error.stack) {
        // Format stack trace with dimmed color
        const stackLines = error.stack.split('\n').slice(1, 5);
        console.error(formatMessage('error', message, errorMeta));
        stackLines.forEach(line => {
          console.error(chalk.dim(line));
        });
        return;
      }
    } else if (error !== undefined) {
      errorMeta.error = String(error);
    }

    console.error(formatMessage('error', message, errorMeta));
  }

  /**
   * Log a success message (info level with green styling)
   */
  success(message: string, meta: Record<string, unknown> = {}): void {
    if (this.shouldLog('info')) {
      const timestamp = formatTimestamp();
      const levelBadge = chalk.green.bold('OK   ');
      const formattedMessage = chalk.green(message);
      const metaStr = formatMeta(meta);
      console.log(`${timestamp} ${levelBadge} ${formattedMessage}${metaStr}`);
    }
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
    this.levelValue = LOG_LEVELS[level];
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }
}

/**
 * Default logger instance (will be initialized with config level)
 */
let loggerInstance: Logger | null = null;

/**
 * Create or get the logger instance
 */
export function createLogger(level?: LogLevel): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger(level || 'info');
  } else if (level) {
    loggerInstance.setLevel(level);
  }
  return loggerInstance;
}

/**
 * Get the logger instance (creates with default level if not exists)
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger('info');
  }
  return loggerInstance;
}
