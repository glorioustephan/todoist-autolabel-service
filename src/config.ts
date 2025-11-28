/**
 * Configuration module for the Todoist autolabel service
 * 
 * Environment Variables:
 * - TODOIST_API_TOKEN (Required): Your Todoist API token
 * - ANTHROPIC_API_KEY (Optional): For Claude Haiku fallback classification
 * - POLL_INTERVAL_MS: Polling interval in milliseconds (default: 15000)
 * - CLASSIFICATION_CONFIDENCE_THRESHOLD: Min confidence for local ML (default: 0.6)
 * - MAX_ERROR_LOGS: Maximum error log entries before FIFO purge (default: 1000)
 * - DB_PATH: Path to SQLite database (default: ./data/todoist.db)
 * - LOG_LEVEL: Logging level - debug, info, warn, error (default: info)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

export interface Config {
  // API Keys
  todoistApiToken: string;
  anthropicApiKey: string | null;

  // Service Settings
  pollIntervalMs: number;
  classificationConfidenceThreshold: number;
  maxErrorLogs: number;

  // Paths
  dbPath: string;
  labelsPath: string;
  projectRoot: string;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function getEnvString(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
  }
  return parsed;
}

function getLogLevel(value: string): Config['logLevel'] {
  const validLevels = ['debug', 'info', 'warn', 'error'] as const;
  if (validLevels.includes(value as Config['logLevel'])) {
    return value as Config['logLevel'];
  }
  return 'info';
}

export function loadConfig(): Config {
  const todoistApiToken = getEnvString('TODOIST_API_TOKEN');
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || null;

  return {
    todoistApiToken,
    anthropicApiKey,
    pollIntervalMs: getEnvNumber('POLL_INTERVAL_MS', 15000),
    classificationConfidenceThreshold: parseFloat(
      process.env.CLASSIFICATION_CONFIDENCE_THRESHOLD || '0.6'
    ),
    maxErrorLogs: getEnvNumber('MAX_ERROR_LOGS', 1000),
    dbPath: getEnvString('DB_PATH', path.join(PROJECT_ROOT, 'data', 'todoist.db')),
    labelsPath: path.join(PROJECT_ROOT, 'todoist', 'labels.json'),
    projectRoot: PROJECT_ROOT,
    logLevel: getLogLevel(process.env.LOG_LEVEL || 'info'),
  };
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

// Validate that required environment variables are set
export function validateConfig(): void {
  const config = getConfig();
  
  if (!config.todoistApiToken) {
    throw new Error(
      'TODOIST_API_TOKEN environment variable is not set. ' +
      'Get your token from: https://todoist.com/app/settings/integrations/developer'
    );
  }

  if (config.pollIntervalMs < 1000) {
    throw new Error('POLL_INTERVAL_MS must be at least 1000ms');
  }

  if (config.classificationConfidenceThreshold < 0 || config.classificationConfidenceThreshold > 1) {
    throw new Error('CLASSIFICATION_CONFIDENCE_THRESHOLD must be between 0 and 1');
  }
}

