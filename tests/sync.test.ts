/**
 * Unit tests for sync.ts - Sync orchestration logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncManager, initSyncManager, getSyncManager, resetSyncManager } from '../src/sync.js';
import {
  createMockConfig,
  createMockTodoistTask,
  createMockTaskRecord,
  createMockClassificationResult,
  createMockDatabase,
  createMockTodoistApi,
  createMockClassifier,
  createNetworkError,
  type MockLogger,
  type MockDatabase,
  type MockTodoistApi,
  type MockClassifier,
} from './test-utils.js';
import type { Config, TodoistTask, TaskRecord } from '../src/types.js';

// Mock all dependencies
vi.mock('../src/logger.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock('../src/database.js', () => {
  return {
    getDatabase: vi.fn(),
  };
});

vi.mock('../src/todoist-api.js', () => {
  return {
    getTodoistApi: vi.fn(),
  };
});

vi.mock('../src/classifier.js', () => {
  return {
    getClassifier: vi.fn(),
  };
});

describe('sync.ts - Sync Orchestration', () => {
  let config: Config;
  let syncManager: SyncManager;
  let mockDb: MockDatabase;
  let mockApi: MockTodoistApi;
  let mockClassifier: MockClassifier;
  let mockLogger: MockLogger;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetSyncManager();

    config = createMockConfig();

    // Set up mock instances
    mockDb = createMockDatabase();
    mockApi = createMockTodoistApi();
    mockClassifier = createMockClassifier();

    // Get fresh mock functions and set up their return values
    const { getDatabase } = await import('../src/database.js');
    const { getTodoistApi } = await import('../src/todoist-api.js');
    const { getClassifier } = await import('../src/classifier.js');
    const { getLogger } = await import('../src/logger.js');

    mockLogger = vi.mocked(getLogger)() as unknown as MockLogger;

    vi.mocked(getDatabase).mockReturnValue(mockDb as any);
    vi.mocked(getTodoistApi).mockReturnValue(mockApi as any);
    vi.mocked(getClassifier).mockReturnValue(mockClassifier as any);

    // Reset all mock implementations
    Object.keys(mockDb).forEach(key => {
      if (typeof mockDb[key as keyof typeof mockDb] === 'function') {
        vi.mocked(mockDb[key as keyof typeof mockDb] as any).mockReset();
      }
    });
    Object.keys(mockApi).forEach(key => {
      if (typeof mockApi[key as keyof typeof mockApi] === 'function') {
        vi.mocked(mockApi[key as keyof typeof mockApi] as any).mockReset();
      }
    });
    Object.keys(mockClassifier).forEach(key => {
      if (typeof mockClassifier[key as keyof typeof mockClassifier] === 'function') {
        vi.mocked(mockClassifier[key as keyof typeof mockClassifier] as any).mockReset();
      }
    });

    // Set up default mock returns
    mockDb.getTask.mockReturnValue(null);
    mockDb.getTasksByStatus.mockReturnValue([]);
    mockDb.getPendingRetryableTasks.mockReturnValue([]);
    mockApi.getInboxTasks.mockResolvedValue([]);
    mockClassifier.getAvailableLabels.mockReturnValue(['productivity', 'work', 'personal']);
  });

  afterEach(() => {
    resetSyncManager();
  });

  describe('SyncManager Class', () => {
    beforeEach(() => {
      syncManager = new SyncManager(config);
    });

    describe('sync()', () => {
      it('should process new tasks without labels successfully', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'New task without labels',
            labels: [],
            isCompleted: false,
          }),
          createMockTodoistTask({
            id: 'task-2',
            content: 'Another new task',
            labels: [],
            isCompleted: false,
          }),
        ];

        const mockClassificationResults = [
          createMockClassificationResult({
            taskId: 'task-1',
            labels: ['productivity', 'work'],
          }),
          createMockClassificationResult({
            taskId: 'task-2',
            labels: ['personal'],
          }),
        ];

        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(null); // No existing records
        mockClassifier.classifyTask
          .mockResolvedValueOnce(mockClassificationResults[0])
          .mockResolvedValueOnce(mockClassificationResults[1]);

        const stats = await syncManager.sync();

        expect(stats).toEqual({
          processed: 2,
          classified: 2,
          failed: 0,
          skipped: 0,
        });

        // Verify API calls
        expect(mockApi.getInboxTasks).toHaveBeenCalled();
        expect(mockClassifier.classifyTask).toHaveBeenCalledTimes(2);
        expect(mockApi.updateTaskLabels).toHaveBeenCalledWith('task-1', ['productivity', 'work']);
        expect(mockApi.updateTaskLabels).toHaveBeenCalledWith('task-2', ['personal']);

        // Verify database operations
        expect(mockDb.upsertTask).toHaveBeenCalledTimes(2);
        expect(mockDb.markTaskClassified).toHaveBeenCalledWith('task-1', ['productivity', 'work']);
        expect(mockDb.markTaskClassified).toHaveBeenCalledWith('task-2', ['personal']);
        expect(mockDb.saveLastSyncAt).toHaveBeenCalled();

        // Verify logging
        expect(mockLogger.info).toHaveBeenCalledWith('Found 2 tasks in Inbox');
        expect(mockLogger.info).toHaveBeenCalledWith('2 tasks need classification');
        expect(mockLogger.success).toHaveBeenCalledWith(
          'Task classified',
          { taskId: 'task-1', labels: ['productivity', 'work'] }
        );
        expect(mockLogger.info).toHaveBeenCalledWith('Sync cycle completed', stats);
      });

      it('should skip completed tasks', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Completed task',
            isCompleted: true,
            labels: [],
          }),
          createMockTodoistTask({
            id: 'task-2',
            content: 'Active task',
            isCompleted: false,
            labels: [],
          }),
        ];

        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockClassifier.classifyTask.mockResolvedValue(
          createMockClassificationResult({ taskId: 'task-2', labels: ['work'] })
        );

        const stats = await syncManager.sync();

        expect(stats.processed).toBe(1); // Only the active task
        expect(mockClassifier.classifyTask).toHaveBeenCalledOnce();
        expect(mockClassifier.classifyTask).toHaveBeenCalledWith({
          taskId: 'task-2',
          content: 'Active task',
          description: expect.any(String),
          availableLabels: ['productivity', 'work', 'personal'],
        });
      });

      it('should skip tasks that already have labels', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Task with existing labels',
            labels: ['existing-label'],
            isCompleted: false,
          }),
          createMockTodoistTask({
            id: 'task-2',
            content: 'Task without labels',
            labels: [],
            isCompleted: false,
          }),
        ];

        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(null); // No existing database records
        mockClassifier.classifyTask.mockResolvedValue(
          createMockClassificationResult({ taskId: 'task-2', labels: ['work'] })
        );

        const stats = await syncManager.sync();

        expect(stats.processed).toBe(1); // Only task without labels
        expect(stats.skipped).toBe(0); // Skipped tasks aren't counted in processed

        // Verify task with existing labels was marked as skipped in database
        expect(mockDb.upsertTask).toHaveBeenCalledWith('task-1', 'Task with existing labels');
        expect(mockDb.markTaskSkipped).toHaveBeenCalledWith('task-1');
      });

      it('should skip tasks that are already classified', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Already classified task',
            labels: [],
            isCompleted: false,
          }),
        ];

        const existingTaskRecord = createMockTaskRecord({
          taskId: 'task-1',
          status: 'classified',
          attempts: 1,
        });

        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(existingTaskRecord);

        const stats = await syncManager.sync();

        expect(stats.processed).toBe(0);
        expect(mockClassifier.classifyTask).not.toHaveBeenCalled();
      });

      it('should skip tasks that have reached max attempts', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Failed task with max attempts',
            labels: [],
            isCompleted: false,
          }),
        ];

        const failedTaskRecord = createMockTaskRecord({
          taskId: 'task-1',
          status: 'failed',
          attempts: 3,
        });

        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(failedTaskRecord);

        const stats = await syncManager.sync();

        expect(stats.processed).toBe(0);
        expect(mockClassifier.classifyTask).not.toHaveBeenCalled();
      });

      it('should retry pending tasks with attempts < 3', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Retry-able task',
            labels: [],
            isCompleted: false,
          }),
        ];

        const pendingTaskRecord = createMockTaskRecord({
          taskId: 'task-1',
          status: 'pending',
          attempts: 2,
        });

        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(pendingTaskRecord);
        mockClassifier.classifyTask.mockResolvedValue(
          createMockClassificationResult({ taskId: 'task-1', labels: ['work'] })
        );

        const stats = await syncManager.sync();

        expect(stats.processed).toBe(1);
        expect(stats.classified).toBe(1);
        expect(mockClassifier.classifyTask).toHaveBeenCalled();
      });

      it('should handle classification with no labels (retry logic)', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Task that gets no labels',
            labels: [],
            isCompleted: false,
          }),
        ];

        const existingTaskRecord = createMockTaskRecord({
          taskId: 'task-1',
          status: 'pending',
          attempts: 1,
        });

        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(existingTaskRecord);
        mockClassifier.classifyTask.mockResolvedValue(
          createMockClassificationResult({ taskId: 'task-1', labels: [] })
        );

        const stats = await syncManager.sync();

        expect(stats.processed).toBe(1);
        expect(stats.classified).toBe(0);
        expect(stats.failed).toBe(1); // Counted as failed in stats even though not permanently failed

        expect(mockDb.markTaskAttempted).toHaveBeenCalledWith('task-1');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'No labels assigned to task',
          { taskId: 'task-1' }
        );

        // Should not mark as failed or update labels
        expect(mockDb.markTaskFailed).not.toHaveBeenCalled();
        expect(mockApi.updateTaskLabels).not.toHaveBeenCalled();
      });

      it('should mark task as failed after max attempts with no labels', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Task that consistently gets no labels',
            labels: [],
            isCompleted: false,
          }),
        ];

        const maxAttemptsTaskRecord = createMockTaskRecord({
          taskId: 'task-1',
          status: 'pending',
          attempts: 2, // This will be the 3rd attempt (max)
        });

        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(maxAttemptsTaskRecord);
        mockClassifier.classifyTask.mockResolvedValue(
          createMockClassificationResult({ taskId: 'task-1', labels: [] })
        );

        const stats = await syncManager.sync();

        expect(stats.processed).toBe(1);
        expect(stats.failed).toBe(1);

        expect(mockDb.markTaskFailed).toHaveBeenCalledWith('task-1');
        expect(mockDb.logError).toHaveBeenCalledWith(
          'CLASSIFICATION_EMPTY',
          'No labels could be assigned after max attempts',
          'task-1'
        );
      });

      it('should handle classification errors with retry logic', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Task that causes error',
            labels: [],
            isCompleted: false,
          }),
        ];

        const existingTaskRecord = createMockTaskRecord({
          taskId: 'task-1',
          status: 'pending',
          attempts: 1,
        });

        const classificationError = createNetworkError();
        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(existingTaskRecord);
        mockClassifier.classifyTask.mockRejectedValue(classificationError);

        const stats = await syncManager.sync();

        expect(stats.processed).toBe(1);
        expect(stats.failed).toBe(1);

        expect(mockDb.markTaskAttempted).toHaveBeenCalledWith('task-1');
        expect(mockDb.logError).toHaveBeenCalledWith(
          'CLASSIFICATION_ERROR',
          'Network request failed',
          'task-1',
          expect.any(String)
        );

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Task classification failed, will retry',
          {
            taskId: 'task-1',
            attempts: 2, // attempts + 1
            error: 'Network request failed',
          }
        );
      });

      it('should mark task as permanently failed after max attempts with errors', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Task that consistently errors',
            labels: [],
            isCompleted: false,
          }),
        ];

        const maxAttemptsTaskRecord = createMockTaskRecord({
          taskId: 'task-1',
          status: 'pending',
          attempts: 2, // This will be the 3rd attempt (max)
        });

        const classificationError = createNetworkError();
        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(maxAttemptsTaskRecord);
        mockClassifier.classifyTask.mockRejectedValue(classificationError);

        const stats = await syncManager.sync();

        expect(stats.failed).toBe(1);

        expect(mockDb.markTaskFailed).toHaveBeenCalledWith('task-1');
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Task classification permanently failed',
          classificationError,
          {
            taskId: 'task-1',
            attempts: 3,
          }
        );
      });

      it('should handle Todoist API update errors', async () => {
        const mockTasks: TodoistTask[] = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Task with API update error',
            labels: [],
            isCompleted: false,
          }),
        ];

        const updateError = createNetworkError();
        mockApi.getInboxTasks.mockResolvedValue(mockTasks);
        mockDb.getTask.mockReturnValue(null);
        mockClassifier.classifyTask.mockResolvedValue(
          createMockClassificationResult({ taskId: 'task-1', labels: ['work'] })
        );
        mockApi.updateTaskLabels.mockRejectedValue(updateError);

        const stats = await syncManager.sync();

        expect(stats.processed).toBe(1);
        expect(stats.failed).toBe(1);

        expect(mockDb.logError).toHaveBeenCalledWith(
          'CLASSIFICATION_ERROR',
          'Network request failed',
          'task-1',
          expect.any(String)
        );

        // Should not mark as classified if API update fails
        expect(mockDb.markTaskClassified).not.toHaveBeenCalled();
      });

      it('should prevent concurrent sync operations', async () => {
        mockApi.getInboxTasks.mockResolvedValue([]);

        // Start first sync
        const sync1Promise = syncManager.sync();

        // Start second sync immediately (should be skipped)
        const sync2Promise = syncManager.sync();

        const [result1, result2] = await Promise.all([sync1Promise, sync2Promise]);

        expect(result1.processed).toBe(0);
        expect(result2.processed).toBe(0);

        // API should only be called once
        expect(mockApi.getInboxTasks).toHaveBeenCalledTimes(1);
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Sync already in progress, skipping'
        );
      });

      it('should handle empty task list', async () => {
        mockApi.getInboxTasks.mockResolvedValue([]);

        const stats = await syncManager.sync();

        expect(stats).toEqual({
          processed: 0,
          classified: 0,
          failed: 0,
          skipped: 0,
        });

        expect(mockLogger.info).toHaveBeenCalledWith('Found 0 tasks in Inbox');
        expect(mockLogger.info).toHaveBeenCalledWith('0 tasks need classification');
      });

      it('should handle sync-level errors', async () => {
        const apiError = createNetworkError();
        mockApi.getInboxTasks.mockRejectedValue(apiError);

        await expect(syncManager.sync()).rejects.toThrow('Network request failed');

        expect(mockDb.logError).toHaveBeenCalledWith(
          'SYNC_ERROR',
          'Network request failed',
          undefined,
          expect.any(String)
        );

        expect(mockLogger.error).toHaveBeenCalledWith('Sync cycle failed', apiError);
      });
    });

    describe('retryFailedTasks()', () => {
      it('should retry pending tasks that havent reached max attempts', async () => {
        const pendingTasks: TaskRecord[] = [
          createMockTaskRecord({
            taskId: 'task-1',
            content: 'Retry task 1',
            status: 'pending',
            attempts: 1,
          }),
          createMockTaskRecord({
            taskId: 'task-2',
            content: 'Retry task 2',
            status: 'pending',
            attempts: 2,
          }),
        ];

        const mockTasks = [
          createMockTodoistTask({
            id: 'task-1',
            content: 'Retry task 1',
            labels: [],
          }),
          createMockTodoistTask({
            id: 'task-2',
            content: 'Retry task 2',
            labels: [],
          }),
        ];

        mockDb.getPendingRetryableTasks.mockReturnValue(pendingTasks);
        mockApi.getTask
          .mockResolvedValueOnce(mockTasks[0])
          .mockResolvedValueOnce(mockTasks[1]);
        mockClassifier.classifyTask
          .mockResolvedValueOnce(createMockClassificationResult({
            taskId: 'task-1',
            labels: ['productivity'],
          }))
          .mockResolvedValueOnce(createMockClassificationResult({
            taskId: 'task-2',
            labels: ['work'],
          }));

        const retried = await syncManager.retryFailedTasks();

        expect(retried).toBe(2);
        expect(mockDb.getPendingRetryableTasks).toHaveBeenCalled();
        expect(mockApi.getTask).toHaveBeenCalledTimes(2);
        expect(mockClassifier.classifyTask).toHaveBeenCalledTimes(2);
        expect(mockApi.updateTaskLabels).toHaveBeenCalledWith('task-1', ['productivity']);
        expect(mockApi.updateTaskLabels).toHaveBeenCalledWith('task-2', ['work']);

        expect(mockLogger.info).toHaveBeenCalledWith('Found 2 tasks to retry');
      });

      it('should skip deleted tasks', async () => {
        const pendingTasks: TaskRecord[] = [
          createMockTaskRecord({
            taskId: 'deleted-task',
            content: 'This task was deleted',
            status: 'pending',
            attempts: 1,
          }),
        ];

        mockDb.getPendingRetryableTasks.mockReturnValue(pendingTasks);
        mockApi.getTask.mockResolvedValue(null); // Task not found

        const retried = await syncManager.retryFailedTasks();

        expect(retried).toBe(0);
        expect(mockDb.markTaskSkipped).toHaveBeenCalledWith('deleted-task');
      });

      it('should skip tasks that now have labels', async () => {
        const pendingTasks: TaskRecord[] = [
          createMockTaskRecord({
            taskId: 'task-1',
            content: 'Task now has labels',
            status: 'pending',
            attempts: 1,
          }),
        ];

        const taskWithLabels = createMockTodoistTask({
          id: 'task-1',
          content: 'Task now has labels',
          labels: ['manually-added'],
        });

        mockDb.getPendingRetryableTasks.mockReturnValue(pendingTasks);
        mockApi.getTask.mockResolvedValue(taskWithLabels);

        const retried = await syncManager.retryFailedTasks();

        expect(retried).toBe(0);
        expect(mockDb.markTaskSkipped).toHaveBeenCalledWith('task-1');
        expect(mockClassifier.classifyTask).not.toHaveBeenCalled();
      });

      it('should handle errors during retry gracefully', async () => {
        const pendingTasks: TaskRecord[] = [
          createMockTaskRecord({
            taskId: 'error-task',
            content: 'Task that causes error on retry',
            status: 'pending',
            attempts: 1,
          }),
        ];

        const apiError = createNetworkError();
        mockDb.getPendingRetryableTasks.mockReturnValue(pendingTasks);
        mockApi.getTask.mockRejectedValue(apiError);

        const retried = await syncManager.retryFailedTasks();

        expect(retried).toBe(0);
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error retrying task',
          apiError,
          { taskId: 'error-task' }
        );
      });

      it('should handle empty pending tasks list', async () => {
        mockDb.getPendingRetryableTasks.mockReturnValue([]);

        const retried = await syncManager.retryFailedTasks();

        expect(retried).toBe(0);
        expect(mockLogger.info).toHaveBeenCalledWith('Found 0 tasks to retry');
        expect(mockApi.getTask).not.toHaveBeenCalled();
      });
    });
  });

  describe('Module Functions', () => {
    describe('initSyncManager()', () => {
      it('should create sync manager instance', () => {
        const manager = initSyncManager(config);

        expect(manager).toBeInstanceOf(SyncManager);
      });

      it('should return same instance on subsequent calls', () => {
        const manager1 = initSyncManager(config);
        const manager2 = initSyncManager(config);

        expect(manager1).toBe(manager2);
      });
    });

    describe('getSyncManager()', () => {
      it('should throw error if not initialized', () => {
        resetSyncManager();

        expect(() => {
          getSyncManager();
        }).toThrow('Sync manager not initialized. Call initSyncManager first.');
      });

      it('should return initialized sync manager', () => {
        const initializedManager = initSyncManager(config);
        const retrievedManager = getSyncManager();

        expect(retrievedManager).toBe(initializedManager);
      });
    });

    describe('resetSyncManager()', () => {
      it('should reset sync manager instance', () => {
        initSyncManager(config);
        resetSyncManager();

        expect(() => {
          getSyncManager();
        }).toThrow('Sync manager not initialized');
      });

      it('should allow reinitialization after reset', () => {
        initSyncManager(config);
        resetSyncManager();

        const newManager = initSyncManager(config);
        expect(newManager).toBeInstanceOf(SyncManager);
      });
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(() => {
      syncManager = new SyncManager(config);
    });

    it('should handle mixed task scenarios in single sync', async () => {
      const mockTasks: TodoistTask[] = [
        createMockTodoistTask({
          id: 'new-task',
          content: 'Brand new task',
          labels: [],
          isCompleted: false,
        }),
        createMockTodoistTask({
          id: 'labeled-task',
          content: 'Task with existing labels',
          labels: ['existing'],
          isCompleted: false,
        }),
        createMockTodoistTask({
          id: 'completed-task',
          content: 'Completed task',
          labels: [],
          isCompleted: true,
        }),
      ];

      const existingFailedRecord = createMockTaskRecord({
        taskId: 'retry-task',
        status: 'pending',
        attempts: 1,
      });

      // Add a retry task that exists in database but not in current sync
      mockTasks.push(createMockTodoistTask({
        id: 'retry-task',
        content: 'Task to retry',
        labels: [],
        isCompleted: false,
      }));

      mockApi.getInboxTasks.mockResolvedValue(mockTasks);
      mockDb.getTask
        .mockReturnValueOnce(null) // new-task
        .mockReturnValueOnce(null) // labeled-task
        .mockReturnValueOnce(null) // completed-task
        .mockReturnValueOnce(existingFailedRecord); // retry-task

      mockClassifier.classifyTask
        .mockResolvedValueOnce(createMockClassificationResult({
          taskId: 'new-task',
          labels: ['productivity'],
        }))
        .mockResolvedValueOnce(createMockClassificationResult({
          taskId: 'retry-task',
          labels: ['work'],
        }));

      const stats = await syncManager.sync();

      expect(stats.processed).toBe(2); // new-task and retry-task
      expect(stats.classified).toBe(2);
      expect(stats.failed).toBe(0);
      expect(stats.skipped).toBe(0);

      // Verify labeled-task was marked as skipped
      expect(mockDb.markTaskSkipped).toHaveBeenCalledWith('labeled-task');

      // Verify new-task was classified
      expect(mockApi.updateTaskLabels).toHaveBeenCalledWith('new-task', ['productivity']);
      expect(mockDb.markTaskClassified).toHaveBeenCalledWith('new-task', ['productivity']);

      // Verify retry-task was classified
      expect(mockApi.updateTaskLabels).toHaveBeenCalledWith('retry-task', ['work']);
      expect(mockDb.markTaskClassified).toHaveBeenCalledWith('retry-task', ['work']);
    });

    it('should handle partial failures gracefully', async () => {
      const mockTasks: TodoistTask[] = [
        createMockTodoistTask({
          id: 'success-task',
          content: 'This will succeed',
          labels: [],
          isCompleted: false,
        }),
        createMockTodoistTask({
          id: 'fail-task',
          content: 'This will fail',
          labels: [],
          isCompleted: false,
        }),
      ];

      mockApi.getInboxTasks.mockResolvedValue(mockTasks);
      mockDb.getTask.mockReturnValue(null);

      const successResult = createMockClassificationResult({
        taskId: 'success-task',
        labels: ['productivity'],
      });
      const failureError = createNetworkError();

      mockClassifier.classifyTask
        .mockResolvedValueOnce(successResult)
        .mockRejectedValueOnce(failureError);

      const stats = await syncManager.sync();

      expect(stats.processed).toBe(2);
      expect(stats.classified).toBe(1);
      expect(stats.failed).toBe(1);

      // Success case should complete normally
      expect(mockApi.updateTaskLabels).toHaveBeenCalledWith('success-task', ['productivity']);
      expect(mockDb.markTaskClassified).toHaveBeenCalledWith('success-task', ['productivity']);

      // Failure case should log error and increment attempts
      expect(mockDb.logError).toHaveBeenCalledWith(
        'CLASSIFICATION_ERROR',
        'Network request failed',
        'fail-task',
        expect.any(String)
      );
    });

    it('should handle large number of tasks efficiently', async () => {
      const manyTasks = Array.from({ length: 100 }, (_, i) =>
        createMockTodoistTask({
          id: `task-${i}`,
          content: `Task ${i}`,
          labels: [],
          isCompleted: false,
        })
      );

      mockApi.getInboxTasks.mockResolvedValue(manyTasks);
      mockDb.getTask.mockReturnValue(null);

      // Mock all classifications to succeed
      for (let i = 0; i < 100; i++) {
        mockClassifier.classifyTask.mockResolvedValueOnce(
          createMockClassificationResult({
            taskId: `task-${i}`,
            labels: ['bulk-test'],
          })
        );
      }

      const stats = await syncManager.sync();

      expect(stats.processed).toBe(100);
      expect(stats.classified).toBe(100);
      expect(mockClassifier.classifyTask).toHaveBeenCalledTimes(100);
      expect(mockApi.updateTaskLabels).toHaveBeenCalledTimes(100);
      expect(mockDb.markTaskClassified).toHaveBeenCalledTimes(100);
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    beforeEach(() => {
      syncManager = new SyncManager(config);
    });

    it('should handle malformed task data gracefully', async () => {
      const malformedTask = {
        id: 'malformed-task',
        content: null, // Invalid content
        description: undefined,
        labels: null,
        isCompleted: false,
      } as unknown as TodoistTask;

      mockApi.getInboxTasks.mockResolvedValue([malformedTask]);
      mockDb.getTask.mockReturnValue(null);
      mockClassifier.classifyTask.mockResolvedValue(
        createMockClassificationResult({
          taskId: 'malformed-task',
          labels: ['recovered'],
        })
      );

      // Should not throw error
      const stats = await syncManager.sync();

      expect(stats.processed).toBe(1);
      expect(stats.classified).toBe(1);
    });

    it('should handle database transaction failures', async () => {
      const mockTasks: TodoistTask[] = [
        createMockTodoistTask({
          id: 'db-fail-task',
          content: 'Database will fail',
          labels: [],
          isCompleted: false,
        }),
      ];

      mockApi.getInboxTasks.mockResolvedValue(mockTasks);
      mockDb.getTask.mockReturnValue(null);
      mockDb.upsertTask.mockImplementation(() => {
        throw new Error('Database constraint violation');
      });

      const stats = await syncManager.sync();

      // Task processing error should be caught and logged
      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.classified).toBe(0);
      expect(stats.skipped).toBe(0);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error processing task',
        expect.any(Error),
        { taskId: 'db-fail-task' }
      );
    });

    it('should handle very long task content', async () => {
      const longContent = 'A'.repeat(100000);
      const mockTasks: TodoistTask[] = [
        createMockTodoistTask({
          id: 'long-task',
          content: longContent,
          labels: [],
          isCompleted: false,
        }),
      ];

      mockApi.getInboxTasks.mockResolvedValue(mockTasks);
      mockDb.getTask.mockReturnValue(null);
      mockClassifier.classifyTask.mockResolvedValue(
        createMockClassificationResult({
          taskId: 'long-task',
          labels: ['long-content'],
        })
      );

      const stats = await syncManager.sync();

      expect(stats.processed).toBe(1);
      expect(stats.classified).toBe(1);
    });

    it('should maintain sync state consistency across errors', async () => {
      // Simulate sync failure
      const syncError = createNetworkError();
      mockApi.getInboxTasks.mockRejectedValue(syncError);

      await expect(syncManager.sync()).rejects.toThrow('Network request failed');

      // Should still be able to sync again after error
      mockApi.getInboxTasks.mockResolvedValue([]);

      const stats = await syncManager.sync();
      expect(stats.processed).toBe(0);
    });
  });
});