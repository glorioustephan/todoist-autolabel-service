/**
 * Configuration loader for Todoist Autolabel Service
 */

import dotenv from 'dotenv';
import path from 'path';
import type { Config, LogLevel } from './types.js';

/**
 * Resolve a path relative to the user's current working directory.
 *
 * The service is published as an npm package, so the package root lives
 * inside the consumer's `node_modules` and must NOT be used to anchor
 * runtime files (`.env`, `labels.json`, the SQLite DB). Those belong to
 * the consumer and live next to wherever the CLI was invoked.
 */
function resolveFromCwd(...pathSegments: string[]): string {
  return path.resolve(process.cwd(), ...pathSegments);
}

// Load .env file from the consumer's working directory.
dotenv.config({ path: resolveFromCwd('.env') });

/**
 * Validates that a required environment variable is set
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

/**
 * Gets an optional environment variable with a default value
 */
function getEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/**
 * Gets an optional environment variable as a number
 */
function getEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`${name} must be a valid number`);
  }
  return parsed;
}

/**
 * Validates the log level
 */
function validateLogLevel(level: string): LogLevel {
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(level as LogLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${level}. Must be one of: ${validLevels.join(', ')}`);
  }
  return level as LogLevel;
}

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
  return {
    // Required
    todoistApiToken: requireEnv('TODOIST_API_TOKEN'),
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),

    // Claude configuration (Structured Outputs is supported on Haiku 4.5+, Sonnet 4.5+, and Opus 4+)
    anthropicModel: getEnv('ANTHROPIC_MODEL', 'claude-haiku-4-5-20251001'),
    maxLabelsPerTask: getEnvNumber('MAX_LABELS_PER_TASK', 5),

    // Service configuration
    pollIntervalMs: getEnvNumber('POLL_INTERVAL_MS', 15000),
    maxErrorLogs: getEnvNumber('MAX_ERROR_LOGS', 1000),
    dbPath: getEnv('DB_PATH', resolveFromCwd('data', 'todoist.db')),
    logLevel: validateLogLevel(getEnv('LOG_LEVEL', 'info')),

    // Paths (resolved from CWD; override either with an env var)
    labelsPath: getEnv('LABELS_PATH', resolveFromCwd('labels.json')),
  };
}

/**
 * Singleton config instance
 */
let configInstance: Config | null = null;

/**
 * Get the configuration (loads once on first call)
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset config (for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}

