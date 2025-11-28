/**
 * Test utilities for Todoist Autolabel Service
 */

import path from 'path';
import fs from 'fs';
import { vi } from 'vitest';
import type {
  Config,
  TodoistTask,
  TodoistLabel,
  TaskRecord,
  ErrorLogRecord,
  ClassificationResult,
  LabelDefinition,
} from '../src/types.js';

// ============================================
// Mock Data Factories
// ============================================

/**
 * Create a mock Config object with sensible defaults
 */
export function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    todoistApiToken: 'test-todoist-token',
    anthropicApiKey: 'test-anthropic-key',
    anthropicModel: 'claude-haiku-4-5-20251001',
    maxLabelsPerTask: 5,
    pollIntervalMs: 15000,
    maxErrorLogs: 1000,
    dbPath: ':memory:', // Use in-memory SQLite for tests
    logLevel: 'error', // Reduce test noise
    labelsPath: path.join(process.cwd(), 'test-labels.json'),
    ...overrides,
  };
}

/**
 * Create a mock TodoistTask
 */
export function createMockTodoistTask(overrides: Partial<TodoistTask> = {}): TodoistTask {
  return {
    id: `task-${Math.random().toString(36).substr(2, 9)}`,
    content: 'Test task content',
    description: 'Test task description',
    projectId: 'inbox-project-id',
    labels: [],
    priority: 1,
    createdAt: new Date().toISOString(),
    isCompleted: false,
    ...overrides,
  };
}

/**
 * Create a mock TodoistLabel
 */
export function createMockTodoistLabel(overrides: Partial<TodoistLabel> = {}): TodoistLabel {
  return {
    id: `label-${Math.random().toString(36).substr(2, 9)}`,
    name: 'test-label',
    color: 'blue',
    ...overrides,
  };
}

/**
 * Create a mock TaskRecord
 */
export function createMockTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: `task-${Math.random().toString(36).substr(2, 9)}`,
    content: 'Test task content',
    status: 'pending',
    labels: null,
    attempts: 0,
    lastAttemptAt: null,
    classifiedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock ErrorLogRecord
 */
export function createMockErrorLogRecord(overrides: Partial<ErrorLogRecord> = {}): ErrorLogRecord {
  return {
    id: Math.floor(Math.random() * 1000),
    taskId: `task-${Math.random().toString(36).substr(2, 9)}`,
    errorType: 'TEST_ERROR',
    errorMessage: 'Test error message',
    stackTrace: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock ClassificationResult
 */
export function createMockClassificationResult(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    taskId: `task-${Math.random().toString(36).substr(2, 9)}`,
    labels: ['productivity', 'work'],
    confidence: 0.85,
    rawResponse: '["productivity", "work"]',
    ...overrides,
  };
}

/**
 * Create mock label definitions
 */
export function createMockLabels(): LabelDefinition[] {
  return [
    { name: 'productivity', color: 'blue' },
    { name: 'work', color: 'green' },
    { name: 'personal', color: 'red' },
    { name: 'health', color: 'orange' },
    { name: 'finance', color: 'purple' },
  ];
}

// ============================================
// File System Utilities
// ============================================

/**
 * Create a temporary labels.json file for testing
 */
export function createTempLabelsFile(labels: LabelDefinition[] = createMockLabels()): string {
  const tempPath = path.join(process.cwd(), 'temp-labels.json');
  const content = JSON.stringify({ labels }, null, 2);
  fs.writeFileSync(tempPath, content);
  return tempPath;
}

/**
 * Clean up temporary files
 */
export function cleanupTempFiles(paths: string[]): void {
  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================
// Mock Utilities
// ============================================

/**
 * Create a mock database instance
 */
export function createMockDatabase() {
  return {
    getSyncState: vi.fn().mockReturnValue({
      syncToken: null,
      lastSyncAt: null,
      inboxProjectId: null,
    }),
    saveSyncToken: vi.fn(),
    saveLastSyncAt: vi.fn(),
    saveInboxProjectId: vi.fn(),
    getTask: vi.fn(),
    getTasksByStatus: vi.fn().mockReturnValue([]),
    getPendingRetryableTasks: vi.fn().mockReturnValue([]),
    upsertTask: vi.fn(),
    markTaskClassified: vi.fn(),
    markTaskAttempted: vi.fn(),
    markTaskFailed: vi.fn(),
    markTaskSkipped: vi.fn(),
    taskNeedsClassification: vi.fn().mockReturnValue(true),
    logError: vi.fn(),
    getRecentErrors: vi.fn().mockReturnValue([]),
    getTaskErrors: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({
      total: 0,
      classified: 0,
      failed: 0,
      pending: 0,
      skipped: 0,
    }),
    close: vi.fn(),
  };
}

/**
 * Create a mock Todoist API instance
 */
export function createMockTodoistApi() {
  return {
    initialize: vi.fn(),
    getInboxProjectId: vi.fn().mockReturnValue('inbox-project-id'),
    getInboxTasks: vi.fn().mockResolvedValue([]),
    getLabels: vi.fn().mockResolvedValue([]),
    updateTaskLabels: vi.fn(),
    getTask: vi.fn(),
    validateLabels: vi.fn().mockResolvedValue({ valid: [], invalid: [] }),
  };
}

/**
 * Create a mock classifier instance
 */
export function createMockClassifier() {
  return {
    getAvailableLabels: vi.fn().mockReturnValue(['productivity', 'work', 'personal']),
    reloadLabels: vi.fn(),
    classifyTask: vi.fn(),
    classifyTasks: vi.fn(),
  };
}

/**
 * Create a mock logger instance
 */
export function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    setLevel: vi.fn(),
    getLevel: vi.fn().mockReturnValue('info'),
  };
}

// ============================================
// Async Test Utilities
// ============================================

/**
 * Wait for a condition to be true
 */
export function waitFor(condition: () => boolean, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - start > timeout) {
        reject(new Error('Condition not met within timeout'));
      } else {
        setTimeout(check, 10);
      }
    };

    check();
  });
}

/**
 * Create a promise that resolves after a delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Error Simulation Utilities
// ============================================

/**
 * Create a mock error for testing error handling
 */
export function createMockError(message = 'Test error', stack?: string): Error {
  const error = new Error(message);
  if (stack) {
    error.stack = stack;
  }
  return error;
}

/**
 * Create a mock network error for API testing
 */
export function createNetworkError(): Error {
  const error = new Error('Network request failed');
  error.name = 'NetworkError';
  return error;
}

// ============================================
// Environment Utilities
// ============================================

/**
 * Set environment variables for testing
 */
export function setTestEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

/**
 * Clear environment variables
 */
export function clearTestEnv(keys: string[]): void {
  for (const key of keys) {
    delete process.env[key];
  }
}

/**
 * Restore environment variables
 */
export function withTestEnv<T>(env: Record<string, string>, fn: () => T): T {
  const original = {} as Record<string, string | undefined>;

  // Save original values
  for (const key of Object.keys(env)) {
    original[key] = process.env[key];
  }

  // Set test values
  setTestEnv(env);

  try {
    return fn();
  } finally {
    // Restore original values
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}