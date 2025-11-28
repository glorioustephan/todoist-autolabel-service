/**
 * Unit tests for database.ts - SQLite database operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DatabaseManager, initDatabase, getDatabase, closeDatabase } from '../src/database.js';
import { createMockConfig, createMockTaskRecord, createMockErrorLogRecord } from './test-utils.js';
import type { Config, TaskStatus, TaskRecord } from '../src/types.js';

// Mock better-sqlite3 for testing
const mockDatabase = {
  exec: vi.fn(),
  prepare: vi.fn(),
  pragma: vi.fn(),
  close: vi.fn(),
};

const mockStatement = {
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
};

vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn().mockImplementation(() => mockDatabase),
  };
});

// Mock fs for file system operations
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

// Mock logger
vi.mock('../src/logger.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('database.ts - Database Operations', () => {
  let config: Config;
  let dbManager: DatabaseManager;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Reset database singleton
    closeDatabase();

    // Create test config with in-memory database
    config = createMockConfig({
      dbPath: ':memory:',
      maxErrorLogs: 100,
    });

    // Mock file system checks
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // Reset mock implementations
    mockDatabase.exec.mockClear();
    mockDatabase.prepare.mockReturnValue(mockStatement);
    mockStatement.run.mockClear();
    mockStatement.get.mockClear();
    mockStatement.all.mockClear();

    // Set up default returns for common queries
    mockStatement.get.mockReturnValue({ count: 0 }); // For COUNT queries
    mockStatement.all.mockReturnValue([]); // For SELECT queries
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('DatabaseManager Class', () => {
    describe('Constructor and Initialization', () => {
      it('should initialize database with proper configuration', () => {
        dbManager = new DatabaseManager(config);

        expect(mockDatabase.pragma).toHaveBeenCalledWith('journal_mode = WAL');
        expect(mockDatabase.pragma).toHaveBeenCalledWith('busy_timeout = 5000');
        expect(mockDatabase.exec).toHaveBeenCalledWith(
          expect.stringContaining('CREATE TABLE IF NOT EXISTS sync_state')
        );
        expect(mockDatabase.exec).toHaveBeenCalledWith(
          expect.stringContaining('CREATE TABLE IF NOT EXISTS tasks')
        );
        expect(mockDatabase.exec).toHaveBeenCalledWith(
          expect.stringContaining('CREATE TABLE IF NOT EXISTS error_logs')
        );
      });

      it('should create data directory if it does not exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const customConfig = createMockConfig({
          dbPath: '/custom/path/database.db',
        });

        dbManager = new DatabaseManager(customConfig);

        expect(fs.mkdirSync).toHaveBeenCalledWith(
          '/custom/path',
          { recursive: true }
        );
      });

      it('should not create directory if it already exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        dbManager = new DatabaseManager(config);

        expect(fs.mkdirSync).not.toHaveBeenCalled();
      });

      it('should create proper indexes', () => {
        dbManager = new DatabaseManager(config);

        expect(mockDatabase.exec).toHaveBeenCalledWith(
          expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_tasks_status')
        );
        expect(mockDatabase.exec).toHaveBeenCalledWith(
          expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_error_logs_created_at')
        );
        expect(mockDatabase.exec).toHaveBeenCalledWith(
          expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_error_logs_task_id')
        );
      });
    });

    describe('Sync State Operations', () => {
      beforeEach(() => {
        dbManager = new DatabaseManager(config);
      });

      describe('getSyncState()', () => {
        it('should return default sync state when no data exists', () => {
          mockStatement.all.mockReturnValue([]);

          const syncState = dbManager.getSyncState();

          expect(syncState).toEqual({
            syncToken: null,
            lastSyncAt: null,
            inboxProjectId: null,
          });
        });

        it('should return parsed sync state from database', () => {
          const mockRows = [
            { key: 'sync_token', value: 'token-123' },
            { key: 'last_sync_at', value: '2024-01-01T00:00:00Z' },
            { key: 'inbox_project_id', value: 'inbox-456' },
          ];
          mockStatement.all.mockReturnValue(mockRows);

          const syncState = dbManager.getSyncState();

          expect(syncState).toEqual({
            syncToken: 'token-123',
            lastSyncAt: '2024-01-01T00:00:00Z',
            inboxProjectId: 'inbox-456',
          });
        });

        it('should handle partial sync state data', () => {
          const mockRows = [
            { key: 'sync_token', value: 'token-123' },
            // Missing other keys
          ];
          mockStatement.all.mockReturnValue(mockRows);

          const syncState = dbManager.getSyncState();

          expect(syncState).toEqual({
            syncToken: 'token-123',
            lastSyncAt: null,
            inboxProjectId: null,
          });
        });
      });

      describe('saveSyncToken()', () => {
        it('should save sync token using upsert', () => {
          dbManager.saveSyncToken('new-token');

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO sync_state')
          );
          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT(key) DO UPDATE SET')
          );
          expect(mockStatement.run).toHaveBeenCalledWith('new-token');
        });
      });

      describe('saveLastSyncAt()', () => {
        it('should save current timestamp', () => {
          dbManager.saveLastSyncAt();

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining("VALUES ('last_sync_at', datetime('now'), datetime('now'))")
          );
          expect(mockStatement.run).toHaveBeenCalledWith();
        });
      });

      describe('saveInboxProjectId()', () => {
        it('should save inbox project ID using upsert', () => {
          dbManager.saveInboxProjectId('project-789');

          expect(mockStatement.run).toHaveBeenCalledWith('project-789');
        });
      });
    });

    describe('Task Operations', () => {
      beforeEach(() => {
        dbManager = new DatabaseManager(config);
      });

      describe('getTask()', () => {
        it('should return null when task not found', () => {
          mockStatement.get.mockReturnValue(undefined);

          const task = dbManager.getTask('nonexistent-task');

          expect(task).toBeNull();
          expect(mockStatement.get).toHaveBeenCalledWith('nonexistent-task');
        });

        it('should return mapped task record when found', () => {
          const mockRow = {
            task_id: 'task-123',
            content: 'Test task',
            status: 'pending',
            labels: '["productivity"]',
            attempts: 2,
            last_attempt_at: '2024-01-01T00:00:00Z',
            classified_at: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          };
          mockStatement.get.mockReturnValue(mockRow);

          const task = dbManager.getTask('task-123');

          expect(task).toEqual({
            taskId: 'task-123',
            content: 'Test task',
            status: 'pending',
            labels: '["productivity"]',
            attempts: 2,
            lastAttemptAt: '2024-01-01T00:00:00Z',
            classifiedAt: null,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          });
        });
      });

      describe('getTasksByStatus()', () => {
        it('should return empty array when no tasks match status', () => {
          mockStatement.all.mockReturnValue([]);

          const tasks = dbManager.getTasksByStatus('failed');

          expect(tasks).toEqual([]);
          expect(mockStatement.all).toHaveBeenCalledWith('failed');
        });

        it('should return mapped task records for given status', () => {
          const mockRows = [
            {
              task_id: 'task-1',
              content: 'Task 1',
              status: 'pending',
              labels: null,
              attempts: 0,
              last_attempt_at: null,
              classified_at: null,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
            {
              task_id: 'task-2',
              content: 'Task 2',
              status: 'pending',
              labels: null,
              attempts: 1,
              last_attempt_at: '2024-01-01T01:00:00Z',
              classified_at: null,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T01:00:00Z',
            },
          ];
          mockStatement.all.mockReturnValue(mockRows);

          const tasks = dbManager.getTasksByStatus('pending');

          expect(tasks).toHaveLength(2);
          expect(tasks[0].taskId).toBe('task-1');
          expect(tasks[1].taskId).toBe('task-2');
        });
      });

      describe('getPendingRetryableTasks()', () => {
        it('should return tasks with status pending and attempts < 3', () => {
          const mockRows = [
            {
              task_id: 'task-1',
              content: 'Retryable task',
              status: 'pending',
              labels: null,
              attempts: 2,
              last_attempt_at: '2024-01-01T00:00:00Z',
              classified_at: null,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ];
          mockStatement.all.mockReturnValue(mockRows);

          const tasks = dbManager.getPendingRetryableTasks();

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining("WHERE status = 'pending' AND attempts < 3")
          );
          expect(tasks).toHaveLength(1);
          expect(tasks[0].taskId).toBe('task-1');
        });
      });

      describe('upsertTask()', () => {
        it('should insert new task with default values', () => {
          dbManager.upsertTask('task-123', 'New task content');

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO tasks')
          );
          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT(task_id) DO UPDATE SET')
          );
          expect(mockStatement.run).toHaveBeenCalledWith('task-123', 'New task content');
        });
      });

      describe('markTaskClassified()', () => {
        it('should update task status to classified with labels', () => {
          const labels = ['productivity', 'work'];

          dbManager.markTaskClassified('task-123', labels);

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining("status = 'classified'")
          );
          expect(mockStatement.run).toHaveBeenCalledWith(
            JSON.stringify(labels),
            'task-123'
          );
        });
      });

      describe('markTaskAttempted()', () => {
        it('should increment attempts and update timestamp', () => {
          dbManager.markTaskAttempted('task-123');

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('attempts = attempts + 1')
          );
          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining("last_attempt_at = datetime('now')")
          );
          expect(mockStatement.run).toHaveBeenCalledWith('task-123');
        });
      });

      describe('markTaskFailed()', () => {
        it('should update task status to failed', () => {
          dbManager.markTaskFailed('task-123');

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining("status = 'failed'")
          );
          expect(mockStatement.run).toHaveBeenCalledWith('task-123');
        });
      });

      describe('markTaskSkipped()', () => {
        it('should update task status to skipped', () => {
          dbManager.markTaskSkipped('task-123');

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining("status = 'skipped'")
          );
          expect(mockStatement.run).toHaveBeenCalledWith('task-123');
        });
      });

      describe('taskNeedsClassification()', () => {
        it('should return true for non-existent task', () => {
          mockStatement.get.mockReturnValue(undefined);

          const needsClassification = dbManager.taskNeedsClassification('task-123');

          expect(needsClassification).toBe(true);
        });

        it('should return true for pending task with attempts < 3', () => {
          const mockTask = createMockTaskRecord({
            status: 'pending',
            attempts: 2,
          });
          vi.spyOn(dbManager, 'getTask').mockReturnValue(mockTask);

          const needsClassification = dbManager.taskNeedsClassification('task-123');

          expect(needsClassification).toBe(true);
        });

        it('should return false for pending task with attempts >= 3', () => {
          const mockTask = createMockTaskRecord({
            status: 'pending',
            attempts: 3,
          });
          vi.spyOn(dbManager, 'getTask').mockReturnValue(mockTask);

          const needsClassification = dbManager.taskNeedsClassification('task-123');

          expect(needsClassification).toBe(false);
        });

        it('should return false for classified task', () => {
          const mockTask = createMockTaskRecord({
            status: 'classified',
            attempts: 1,
          });
          vi.spyOn(dbManager, 'getTask').mockReturnValue(mockTask);

          const needsClassification = dbManager.taskNeedsClassification('task-123');

          expect(needsClassification).toBe(false);
        });

        it('should return false for failed task', () => {
          const mockTask = createMockTaskRecord({
            status: 'failed',
            attempts: 3,
          });
          vi.spyOn(dbManager, 'getTask').mockReturnValue(mockTask);

          const needsClassification = dbManager.taskNeedsClassification('task-123');

          expect(needsClassification).toBe(false);
        });

        it('should return false for skipped task', () => {
          const mockTask = createMockTaskRecord({
            status: 'skipped',
            attempts: 0,
          });
          vi.spyOn(dbManager, 'getTask').mockReturnValue(mockTask);

          const needsClassification = dbManager.taskNeedsClassification('task-123');

          expect(needsClassification).toBe(false);
        });
      });
    });

    describe('Error Log Operations', () => {
      beforeEach(() => {
        dbManager = new DatabaseManager(config);
      });

      describe('logError()', () => {
        it('should insert error log with all parameters', () => {
          dbManager.logError(
            'CLASSIFICATION_ERROR',
            'Test error message',
            'task-123',
            'Error stack trace'
          );

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO error_logs')
          );
          expect(mockStatement.run).toHaveBeenCalledWith(
            'task-123',
            'CLASSIFICATION_ERROR',
            'Test error message',
            'Error stack trace'
          );
        });

        it('should insert error log with minimal parameters', () => {
          dbManager.logError('SYNC_ERROR', 'General error');

          expect(mockStatement.run).toHaveBeenCalledWith(
            null,
            'SYNC_ERROR',
            'General error',
            null
          );
        });

        it('should trigger purge after logging', () => {
          // Mock count query to simulate exceeding max logs
          mockStatement.get
            .mockReturnValueOnce({ count: 150 }) // For purge check
            .mockReturnValue(undefined); // For other queries

          const purgeConfig = createMockConfig({ maxErrorLogs: 100 });
          const testDbManager = new DatabaseManager(purgeConfig);

          testDbManager.logError('TEST_ERROR', 'Test');

          // Should call delete statement for purging
          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM error_logs')
          );
        });
      });

      describe('getRecentErrors()', () => {
        it('should return mapped error log records', () => {
          const mockRows = [
            {
              id: 1,
              task_id: 'task-123',
              error_type: 'CLASSIFICATION_ERROR',
              error_message: 'Test error',
              stack_trace: 'Stack trace',
              created_at: '2024-01-01T00:00:00Z',
            },
          ];
          mockStatement.all.mockReturnValue(mockRows);

          const errors = dbManager.getRecentErrors(50);

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('ORDER BY created_at DESC')
          );
          expect(mockStatement.all).toHaveBeenCalledWith(50);
          expect(errors).toHaveLength(1);
          expect(errors[0]).toEqual({
            id: 1,
            taskId: 'task-123',
            errorType: 'CLASSIFICATION_ERROR',
            errorMessage: 'Test error',
            stackTrace: 'Stack trace',
            createdAt: '2024-01-01T00:00:00Z',
          });
        });

        it('should use default limit of 100', () => {
          mockStatement.all.mockReturnValue([]);

          dbManager.getRecentErrors();

          expect(mockStatement.all).toHaveBeenCalledWith(100);
        });
      });

      describe('getTaskErrors()', () => {
        it('should return errors for specific task', () => {
          const mockRows = [
            {
              id: 1,
              task_id: 'task-123',
              error_type: 'CLASSIFICATION_ERROR',
              error_message: 'First error',
              stack_trace: null,
              created_at: '2024-01-01T00:00:00Z',
            },
            {
              id: 2,
              task_id: 'task-123',
              error_type: 'CLASSIFICATION_ERROR',
              error_message: 'Second error',
              stack_trace: null,
              created_at: '2024-01-01T01:00:00Z',
            },
          ];
          mockStatement.all.mockReturnValue(mockRows);

          const errors = dbManager.getTaskErrors('task-123');

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('WHERE task_id = ?')
          );
          expect(mockStatement.all).toHaveBeenCalledWith('task-123');
          expect(errors).toHaveLength(2);
        });
      });

      describe('purgeOldErrorLogs()', () => {
        it('should not purge when under limit', () => {
          mockStatement.get.mockReturnValue({ count: 50 });

          dbManager.logError('TEST_ERROR', 'Test'); // Triggers purge check

          // Should not call delete
          const deleteCalls = mockDatabase.prepare.mock.calls.filter(
            call => call[0].includes('DELETE FROM error_logs')
          );
          expect(deleteCalls).toHaveLength(0);
        });

        it('should purge excess logs when over limit', () => {
          // Mock count to be over limit
          mockStatement.get.mockReturnValue({ count: 150 });

          const customConfig = createMockConfig({ maxErrorLogs: 100 });
          const testDbManager = new DatabaseManager(customConfig);

          testDbManager.logError('TEST_ERROR', 'Test');

          // Should delete 50 oldest logs (150 - 100)
          expect(mockStatement.run).toHaveBeenCalledWith(50);
        });
      });
    });

    describe('Statistics Operations', () => {
      beforeEach(() => {
        dbManager = new DatabaseManager(config);
      });

      describe('getStats()', () => {
        it('should return task statistics', () => {
          const mockRow = {
            total: 100,
            classified: 70,
            failed: 5,
            pending: 20,
            skipped: 5,
          };
          mockStatement.get.mockReturnValue(mockRow);

          const stats = dbManager.getStats();

          expect(mockDatabase.prepare).toHaveBeenCalledWith(
            expect.stringContaining('COUNT(*) as total')
          );
          expect(stats).toEqual({
            total: 100,
            classified: 70,
            failed: 5,
            pending: 20,
            skipped: 5,
          });
        });

        it('should handle null values in statistics', () => {
          const mockRow = {
            total: null,
            classified: null,
            failed: null,
            pending: null,
            skipped: null,
          };
          mockStatement.get.mockReturnValue(mockRow);

          const stats = dbManager.getStats();

          expect(stats).toEqual({
            total: 0,
            classified: 0,
            failed: 0,
            pending: 0,
            skipped: 0,
          });
        });
      });
    });

    describe('Database Lifecycle', () => {
      beforeEach(() => {
        dbManager = new DatabaseManager(config);
      });

      describe('close()', () => {
        it('should close database connection', () => {
          dbManager.close();

          expect(mockDatabase.close).toHaveBeenCalled();
        });
      });
    });
  });

  describe('Module Functions', () => {
    describe('initDatabase()', () => {
      it('should create new database instance', () => {
        const db = initDatabase(config);

        expect(db).toBeInstanceOf(DatabaseManager);
      });

      it('should return existing instance on subsequent calls', () => {
        const db1 = initDatabase(config);
        const db2 = initDatabase(config);

        expect(db1).toBe(db2);
      });
    });

    describe('getDatabase()', () => {
      it('should throw error if not initialized', () => {
        closeDatabase(); // Ensure not initialized

        expect(() => {
          getDatabase();
        }).toThrow('Database not initialized. Call initDatabase first.');
      });

      it('should return initialized database', () => {
        const initializedDb = initDatabase(config);
        const retrievedDb = getDatabase();

        expect(retrievedDb).toBe(initializedDb);
      });
    });

    describe('closeDatabase()', () => {
      it('should close and reset database instance', () => {
        const db = initDatabase(config);
        closeDatabase();

        expect(mockDatabase.close).toHaveBeenCalled();
        expect(() => {
          getDatabase();
        }).toThrow('Database not initialized');
      });

      it('should handle multiple close calls safely', () => {
        initDatabase(config);
        closeDatabase();

        // Should not throw
        expect(() => {
          closeDatabase();
        }).not.toThrow();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      const DatabaseMock = vi.mocked((await import('better-sqlite3')).default);
      DatabaseMock.mockImplementationOnce(() => {
        throw new Error('Database connection failed');
      });

      expect(() => {
        new DatabaseManager(config);
      }).toThrow('Database connection failed');
    });

    it('should handle SQL execution errors', () => {
      mockDatabase.exec.mockImplementationOnce(() => {
        throw new Error('SQL execution failed');
      });

      expect(() => {
        new DatabaseManager(config);
      }).toThrow('SQL execution failed');
    });
  });

  describe('Data Mapping', () => {
    beforeEach(() => {
      dbManager = new DatabaseManager(config);
    });

    it('should correctly map snake_case database columns to camelCase', () => {
      const mockRow = {
        task_id: 'task-123',
        last_attempt_at: '2024-01-01T00:00:00Z',
        classified_at: '2024-01-01T01:00:00Z',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T02:00:00Z',
      };

      // Access private method for testing
      const mappedTask = (dbManager as any).mapTaskRow(mockRow);

      expect(mappedTask).toEqual(
        expect.objectContaining({
          taskId: 'task-123',
          lastAttemptAt: '2024-01-01T00:00:00Z',
          classifiedAt: '2024-01-01T01:00:00Z',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T02:00:00Z',
        })
      );
    });

    it('should correctly map error log database columns', () => {
      const mockRow = {
        id: 1,
        task_id: 'task-123',
        error_type: 'TEST_ERROR',
        error_message: 'Test message',
        stack_trace: 'Stack trace',
        created_at: '2024-01-01T00:00:00Z',
      };

      // Access private method for testing
      const mappedError = (dbManager as any).mapErrorLogRow(mockRow);

      expect(mappedError).toEqual({
        id: 1,
        taskId: 'task-123',
        errorType: 'TEST_ERROR',
        errorMessage: 'Test message',
        stackTrace: 'Stack trace',
        createdAt: '2024-01-01T00:00:00Z',
      });
    });

    it('should handle null values in mapping', () => {
      const mockRow = {
        task_id: 'task-123',
        content: 'Test',
        status: 'pending',
        labels: null,
        attempts: 0,
        last_attempt_at: null,
        classified_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const mappedTask = (dbManager as any).mapTaskRow(mockRow);

      expect(mappedTask.labels).toBeNull();
      expect(mappedTask.lastAttemptAt).toBeNull();
      expect(mappedTask.classifiedAt).toBeNull();
    });
  });
});