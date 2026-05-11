/**
 * Unit tests for todoist-api.ts - Todoist API client wrapper
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TodoistApiManager, initTodoistApi, getTodoistApi, resetTodoistApi } from '../src/todoist-api.js';
import { createMockConfig, createMockTodoistTask, createNetworkError, type MockLogger } from './test-utils.js';
import type { Config } from '../src/types.js';

// Mock the Todoist SDK
const mockTodoistApi = {
  getProjects: vi.fn(),
  getTasks: vi.fn(),
  getLabels: vi.fn(),
  updateTask: vi.fn(),
  getTask: vi.fn(),
};

vi.mock('@doist/todoist-sdk', () => ({
  TodoistApi: vi.fn().mockImplementation(() => mockTodoistApi),
}));

// Helper: wrap an array as a single-page paginated response.
const page = <T>(results: T[]) => ({ results, nextCursor: null });

// Mock logger
vi.mock('../src/logger.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('todoist-api.ts - Todoist API Client', () => {
  let config: Config;
  let apiManager: TodoistApiManager;
  let mockLogger: MockLogger;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetTodoistApi();

    const { getLogger } = await import('../src/logger.js');
    mockLogger = vi.mocked(getLogger)() as unknown as MockLogger;

    config = createMockConfig({
      todoistApiToken: 'test-todoist-token',
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTodoistApi();
  });

  describe('TodoistApiManager Class', () => {
    describe('Constructor', () => {
      it('should initialize with config token', async () => {
        apiManager = new TodoistApiManager(config);

        const sdkModule = await import('@doist/todoist-sdk');
        const sdkCtor = vi.mocked(sdkModule.TodoistApi);
        expect(sdkCtor).toHaveBeenCalledWith('test-todoist-token');
      });
    });

    describe('initialize()', () => {
      beforeEach(() => {
        apiManager = new TodoistApiManager(config);
      });

      it('should fetch and store inbox project ID', async () => {
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'project-1', name: 'Work', inboxProject: false },
          { id: 'inbox-123', name: 'Inbox', inboxProject: true },
          { id: 'project-2', name: 'Personal', inboxProject: false },
        ]));

        const result = await apiManager.initialize();

        expect(result.success).toBe(true);
        expect(mockTodoistApi.getProjects).toHaveBeenCalled();

        const inboxResult = apiManager.getInboxProjectId();
        expect(inboxResult.success).toBe(true);
        if (inboxResult.success) {
          expect(inboxResult.data).toBe('inbox-123');
        }
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Todoist API initialized',
          { inboxProjectId: 'inbox-123' }
        );
      });

      it('should return error when inbox project not found', async () => {
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'project-1', name: 'Work', inboxProject: false },
          { id: 'project-2', name: 'Personal', inboxProject: false },
        ]));

        const result = await apiManager.initialize();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('Could not find Todoist Inbox project');
        }
      });

      it('should handle API errors during initialization', async () => {
        const apiError = createNetworkError();
        mockTodoistApi.getProjects.mockRejectedValue(apiError);

        const result = await apiManager.initialize();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('Network request failed');
        }
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Failed to initialize Todoist API',
          apiError
        );
      });

      it('should return error with empty projects array', async () => {
        mockTodoistApi.getProjects.mockResolvedValue(page([]));

        const result = await apiManager.initialize();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('Could not find Todoist Inbox project');
        }
      });

      it('should walk pagination cursor when inbox is not on the first page', async () => {
        mockTodoistApi.getProjects
          .mockResolvedValueOnce({
            results: [{ id: 'project-1', name: 'Work', inboxProject: false }],
            nextCursor: 'cursor-2',
          })
          .mockResolvedValueOnce({
            results: [{ id: 'inbox-999', name: 'Inbox', inboxProject: true }],
            nextCursor: null,
          });

        const result = await apiManager.initialize();

        expect(result.success).toBe(true);
        expect(mockTodoistApi.getProjects).toHaveBeenCalledTimes(2);
        expect(mockTodoistApi.getProjects).toHaveBeenNthCalledWith(2, { cursor: 'cursor-2' });

        const inboxResult = apiManager.getInboxProjectId();
        if (inboxResult.success) {
          expect(inboxResult.data).toBe('inbox-999');
        }
      });
    });

    describe('getInboxProjectId()', () => {
      beforeEach(() => {
        apiManager = new TodoistApiManager(config);
      });

      it('should return error when not initialized', () => {
        const result = apiManager.getInboxProjectId();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBe('not_initialized');
        }
      });

      it('should return inbox project ID after initialization', async () => {
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'inbox-456', name: 'Inbox', inboxProject: true },
        ]));

        await apiManager.initialize();
        const result = apiManager.getInboxProjectId();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('inbox-456');
        }
      });
    });

    describe('getInboxTasks()', () => {
      beforeEach(async () => {
        apiManager = new TodoistApiManager(config);
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'inbox-123', name: 'Inbox', inboxProject: true },
        ]));
        await apiManager.initialize();
      });

      it('should fetch and transform inbox tasks', async () => {
        mockTodoistApi.getTasks.mockResolvedValue(page([
          {
            id: 'task-1',
            content: 'First task',
            description: 'First description',
            projectId: 'inbox-123',
            labels: ['work', 'urgent'],
            priority: 2,
            addedAt: new Date('2024-01-01T00:00:00Z'),
            checked: false,
          },
          {
            id: 'task-2',
            content: 'Second task',
            description: '',
            projectId: 'inbox-123',
            labels: null,
            priority: 1,
            addedAt: new Date('2024-01-01T01:00:00Z'),
            checked: true,
          },
        ]));

        const result = await apiManager.getInboxTasks();

        expect(mockTodoistApi.getTasks).toHaveBeenCalledWith({
          projectId: 'inbox-123',
          cursor: null,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toHaveLength(2);

          expect(result.data[0]).toEqual({
            id: 'task-1',
            content: 'First task',
            description: 'First description',
            projectId: 'inbox-123',
            labels: ['work', 'urgent'],
            priority: 2,
            createdAt: '2024-01-01T00:00:00.000Z',
            isCompleted: false,
          });

          expect(result.data[1]).toEqual({
            id: 'task-2',
            content: 'Second task',
            description: '',
            projectId: 'inbox-123',
            labels: [],
            priority: 1,
            createdAt: '2024-01-01T01:00:00.000Z',
            isCompleted: true,
          });
        }

        expect(mockLogger.debug).toHaveBeenCalledWith('Fetched 2 tasks from Inbox');
      });

      it('should initialize if not already initialized', async () => {
        const newApiManager = new TodoistApiManager(config);
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'inbox-789', name: 'Inbox', inboxProject: true },
        ]));
        mockTodoistApi.getTasks.mockResolvedValue(page([createSdkTask()]));

        await newApiManager.getInboxTasks();

        expect(mockTodoistApi.getProjects).toHaveBeenCalled();
        expect(mockTodoistApi.getTasks).toHaveBeenCalledWith({
          projectId: 'inbox-789',
          cursor: null,
        });
      });

      it('should handle empty task list', async () => {
        mockTodoistApi.getTasks.mockResolvedValue(page([]));

        const result = await apiManager.getInboxTasks();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual([]);
        }
        expect(mockLogger.debug).toHaveBeenCalledWith('Fetched 0 tasks from Inbox');
      });

      it('should return error on API errors', async () => {
        const apiError = createNetworkError();
        mockTodoistApi.getTasks.mockRejectedValue(apiError);

        const result = await apiManager.getInboxTasks();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('Network request failed');
        }
        expect(mockLogger.error).toHaveBeenCalledWith('Failed to fetch inbox tasks', apiError);
      });

      it('should handle tasks with null description gracefully', async () => {
        mockTodoistApi.getTasks.mockResolvedValue(page([
          {
            id: 'task-1',
            content: 'Task with null description',
            description: null,
            projectId: 'inbox-123',
            labels: [],
            priority: 1,
            addedAt: new Date('2024-01-01T00:00:00Z'),
            checked: false,
          },
        ]));

        const result = await apiManager.getInboxTasks();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data[0]!.description).toBe('');
        }
      });

      it('should walk pagination cursor and collect tasks across pages', async () => {
        mockTodoistApi.getTasks
          .mockResolvedValueOnce({
            results: [createSdkTask({ id: 'task-page-1' })],
            nextCursor: 'next-cursor',
          })
          .mockResolvedValueOnce({
            results: [createSdkTask({ id: 'task-page-2' })],
            nextCursor: null,
          });

        const result = await apiManager.getInboxTasks();

        expect(mockTodoistApi.getTasks).toHaveBeenCalledTimes(2);
        expect(mockTodoistApi.getTasks).toHaveBeenNthCalledWith(2, {
          projectId: 'inbox-123',
          cursor: 'next-cursor',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.map((t) => t.id)).toEqual(['task-page-1', 'task-page-2']);
        }
      });
    });

    describe('getLabels()', () => {
      beforeEach(async () => {
        apiManager = new TodoistApiManager(config);
      });

      it('should fetch and transform labels', async () => {
        mockTodoistApi.getLabels.mockResolvedValue(page([
          { id: 'label-1', name: 'productivity', color: 'blue' },
          { id: 'label-2', name: 'urgent', color: 'red' },
        ]));

        const labels = await apiManager.getLabels();

        expect(mockTodoistApi.getLabels).toHaveBeenCalled();
        expect(labels).toHaveLength(2);
        expect(labels[0]).toEqual({
          id: 'label-1',
          name: 'productivity',
          color: 'blue',
        });
        expect(labels[1]).toEqual({
          id: 'label-2',
          name: 'urgent',
          color: 'red',
        });
        expect(mockLogger.debug).toHaveBeenCalledWith('Fetched 2 labels from Todoist');
      });

      it('should handle empty labels list', async () => {
        mockTodoistApi.getLabels.mockResolvedValue(page([]));

        const labels = await apiManager.getLabels();

        expect(labels).toEqual([]);
        expect(mockLogger.debug).toHaveBeenCalledWith('Fetched 0 labels from Todoist');
      });

      it('should handle API errors', async () => {
        const apiError = createNetworkError();
        mockTodoistApi.getLabels.mockRejectedValue(apiError);

        await expect(apiManager.getLabels()).rejects.toThrow('Network request failed');
        expect(mockLogger.error).toHaveBeenCalledWith('Failed to fetch labels', apiError);
      });
    });

    describe('updateTaskLabels()', () => {
      beforeEach(async () => {
        apiManager = new TodoistApiManager(config);
      });

      it('should update task labels with API delay', async () => {
        const labels = ['productivity', 'urgent'];
        mockTodoistApi.updateTask.mockResolvedValue(undefined);

        const updatePromise = apiManager.updateTaskLabels('task-123', labels);

        vi.advanceTimersByTime(200);

        await updatePromise;

        expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task-123', { labels });
        expect(mockLogger.debug).toHaveBeenCalledWith(
          'Updated task labels',
          { taskId: 'task-123', labels }
        );
      });

      it('should handle empty labels array', async () => {
        mockTodoistApi.updateTask.mockResolvedValue(undefined);

        const updatePromise = apiManager.updateTaskLabels('task-123', []);
        vi.advanceTimersByTime(200);
        await updatePromise;

        expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task-123', { labels: [] });
      });

      it('should handle API errors', async () => {
        const apiError = createNetworkError();
        const labels = ['productivity'];
        mockTodoistApi.updateTask.mockRejectedValue(apiError);

        const updatePromise = apiManager.updateTaskLabels('task-123', labels);
        vi.advanceTimersByTime(200);

        await expect(updatePromise).rejects.toThrow('Network request failed');
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Failed to update task labels',
          apiError,
          { taskId: 'task-123', labels }
        );
      });

      it('should respect API delay timing', async () => {
        mockTodoistApi.updateTask.mockResolvedValue(undefined);

        const updatePromise = apiManager.updateTaskLabels('task-123', ['test']);

        let resolved = false;
        updatePromise.then(() => { resolved = true; });

        expect(resolved).toBe(false);

        vi.advanceTimersByTime(100);
        await Promise.resolve();
        expect(resolved).toBe(false);

        vi.advanceTimersByTime(100);
        await updatePromise;
        expect(resolved).toBe(true);
      });
    });

    describe('getTask()', () => {
      beforeEach(async () => {
        apiManager = new TodoistApiManager(config);
      });

      it('should fetch and transform single task', async () => {
        mockTodoistApi.getTask.mockResolvedValue({
          id: 'task-123',
          content: 'Single task',
          description: 'Task description',
          projectId: 'project-456',
          labels: ['work'],
          priority: 3,
          addedAt: new Date('2024-01-01T00:00:00Z'),
          checked: false,
        });

        const task = await apiManager.getTask('task-123');

        expect(mockTodoistApi.getTask).toHaveBeenCalledWith('task-123');
        expect(task).toEqual({
          id: 'task-123',
          content: 'Single task',
          description: 'Task description',
          projectId: 'project-456',
          labels: ['work'],
          priority: 3,
          createdAt: '2024-01-01T00:00:00.000Z',
          isCompleted: false,
        });
      });

      it('should handle task not found (API error)', async () => {
        const apiError = new Error('Task not found');
        mockTodoistApi.getTask.mockRejectedValue(apiError);

        const task = await apiManager.getTask('nonexistent-task');

        expect(task).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Failed to fetch task',
          { taskId: 'nonexistent-task', error: 'Error: Task not found' }
        );
      });

      it('should handle task with missing optional fields', async () => {
        mockTodoistApi.getTask.mockResolvedValue({
          id: 'task-123',
          content: 'Minimal task',
          description: null,
          projectId: 'project-456',
          labels: null,
          priority: 1,
          addedAt: null,
          checked: false,
        });

        const task = await apiManager.getTask('task-123');

        expect(task).toEqual({
          id: 'task-123',
          content: 'Minimal task',
          description: '',
          projectId: 'project-456',
          labels: [],
          priority: 1,
          createdAt: '',
          isCompleted: false,
        });
      });
    });

    describe('validateLabels()', () => {
      beforeEach(async () => {
        apiManager = new TodoistApiManager(config);
      });

      it('should validate labels against Todoist labels', async () => {
        mockTodoistApi.getLabels.mockResolvedValue(page([
          { id: 'label-1', name: 'productivity', color: 'blue' },
          { id: 'label-2', name: 'urgent', color: 'red' },
          { id: 'label-3', name: 'work', color: 'green' },
        ]));

        const result = await apiManager.validateLabels(['productivity', 'invalid-label', 'work', 'another-invalid']);

        expect(result).toEqual({
          valid: ['productivity', 'work'],
          invalid: ['invalid-label', 'another-invalid'],
        });
      });

      it('should handle empty input labels', async () => {
        mockTodoistApi.getLabels.mockResolvedValue(page([
          { id: 'label-1', name: 'productivity', color: 'blue' },
        ]));

        const result = await apiManager.validateLabels([]);

        expect(result).toEqual({ valid: [], invalid: [] });
      });

      it('should handle empty Todoist labels', async () => {
        mockTodoistApi.getLabels.mockResolvedValue(page([]));

        const result = await apiManager.validateLabels(['any-label']);

        expect(result).toEqual({ valid: [], invalid: ['any-label'] });
      });

      it('should handle all valid labels', async () => {
        mockTodoistApi.getLabels.mockResolvedValue(page([
          { id: 'label-1', name: 'productivity', color: 'blue' },
          { id: 'label-2', name: 'urgent', color: 'red' },
        ]));

        const result = await apiManager.validateLabels(['productivity', 'urgent']);

        expect(result).toEqual({ valid: ['productivity', 'urgent'], invalid: [] });
      });

      it('should handle case-sensitive label matching', async () => {
        mockTodoistApi.getLabels.mockResolvedValue(page([
          { id: 'label-1', name: 'Productivity', color: 'blue' },
        ]));

        const result = await apiManager.validateLabels(['productivity', 'Productivity']);

        expect(result).toEqual({
          valid: ['Productivity'],
          invalid: ['productivity'],
        });
      });

      it('should handle duplicate labels in input', async () => {
        mockTodoistApi.getLabels.mockResolvedValue(page([
          { id: 'label-1', name: 'productivity', color: 'blue' },
        ]));

        const result = await apiManager.validateLabels(['productivity', 'productivity', 'invalid']);

        expect(result).toEqual({
          valid: ['productivity', 'productivity'],
          invalid: ['invalid'],
        });
      });
    });
  });

  describe('Module Functions', () => {
    describe('initTodoistApi()', () => {
      it('should create and initialize API manager', async () => {
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'inbox-123', name: 'Inbox', inboxProject: true },
        ]));

        const api = await initTodoistApi(config);

        expect(api).toBeInstanceOf(TodoistApiManager);
        expect(mockTodoistApi.getProjects).toHaveBeenCalled();
      });

      it('should return existing instance on subsequent calls', async () => {
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'inbox-123', name: 'Inbox', inboxProject: true },
        ]));

        const api1 = await initTodoistApi(config);
        const api2 = await initTodoistApi(config);

        expect(api1).toBe(api2);
        expect(mockTodoistApi.getProjects).toHaveBeenCalledTimes(1);
      });

      it('should handle initialization errors and still return manager', async () => {
        const initError = createNetworkError();
        mockTodoistApi.getProjects.mockRejectedValue(initError);

        const manager = await initTodoistApi(config);
        expect(manager).toBeInstanceOf(TodoistApiManager);
      });
    });

    describe('getTodoistApi()', () => {
      it('should throw error if not initialized', () => {
        resetTodoistApi();

        expect(() => {
          getTodoistApi();
        }).toThrow('Todoist API not initialized. Call initTodoistApi first.');
      });

      it('should return initialized API instance', async () => {
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'inbox-123', name: 'Inbox', inboxProject: true },
        ]));

        const initializedApi = await initTodoistApi(config);
        const retrievedApi = getTodoistApi();

        expect(retrievedApi).toBe(initializedApi);
      });
    });

    describe('resetTodoistApi()', () => {
      it('should reset API instance', async () => {
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'inbox-123', name: 'Inbox', inboxProject: true },
        ]));

        await initTodoistApi(config);
        resetTodoistApi();

        expect(() => {
          getTodoistApi();
        }).toThrow('Todoist API not initialized');
      });

      it('should allow reinitialization after reset', async () => {
        mockTodoistApi.getProjects.mockResolvedValue(page([
          { id: 'inbox-123', name: 'Inbox', inboxProject: true },
        ]));

        await initTodoistApi(config);
        resetTodoistApi();

        const newApi = await initTodoistApi(config);
        expect(newApi).toBeInstanceOf(TodoistApiManager);
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(() => {
      apiManager = new TodoistApiManager(config);
    });

    it('should handle multiple projects with inboxProject true', async () => {
      mockTodoistApi.getProjects.mockResolvedValue(page([
        { id: 'inbox-1', name: 'Inbox 1', inboxProject: true },
        { id: 'inbox-2', name: 'Inbox 2', inboxProject: true },
      ]));

      await apiManager.initialize();

      const result = apiManager.getInboxProjectId();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('inbox-1');
      }
    });

    it('should handle network timeouts', async () => {
      const timeoutError = new Error('Request timeout');
      timeoutError.name = 'TimeoutError';
      mockTodoistApi.getProjects.mockRejectedValue(timeoutError);

      const result = await apiManager.initialize();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Request timeout');
      }
    });

    it('should handle rate limiting errors', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.name = 'RateLimitError';
      mockTodoistApi.updateTask.mockRejectedValue(rateLimitError);

      const updatePromise = apiManager.updateTaskLabels('task-123', ['test']);
      vi.advanceTimersByTime(200);

      await expect(updatePromise).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle invalid task IDs in getTask', async () => {
      const invalidIdError = new Error('Invalid task ID format');
      mockTodoistApi.getTask.mockRejectedValue(invalidIdError);

      const task = await apiManager.getTask('invalid-id-format');

      expect(task).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch task',
        { taskId: 'invalid-id-format', error: 'Error: Invalid task ID format' }
      );
    });

    it('should handle very large label arrays', async () => {
      const manyLabels = Array.from({ length: 1000 }, (_, i) => `label-${i}`);
      mockTodoistApi.updateTask.mockResolvedValue(undefined);

      const updatePromise = apiManager.updateTaskLabels('task-123', manyLabels);
      vi.advanceTimersByTime(200);
      await updatePromise;

      expect(mockTodoistApi.updateTask).toHaveBeenCalledWith('task-123', { labels: manyLabels });
    });

    it('should handle Unicode characters in task content', async () => {
      mockTodoistApi.getTask.mockResolvedValue({
        id: 'task-123',
        content: 'Task with émojis 🚀 and ünicöde',
        description: 'Description with 中文 characters',
        projectId: 'inbox-123',
        labels: ['标签'],
        priority: 1,
        addedAt: new Date('2024-01-01T00:00:00Z'),
        checked: false,
      });

      const task = await apiManager.getTask('task-123');

      expect(task?.content).toBe('Task with émojis 🚀 and ünicöde');
      expect(task?.description).toBe('Description with 中文 characters');
      expect(task?.labels).toEqual(['标签']);
    });
  });
});

// Helper: build a minimal SDK task (new v1 shape) for fixture data.
function createSdkTask(overrides: Partial<{
  id: string;
  content: string;
  description: string | null;
  projectId: string;
  labels: string[];
  priority: number;
  addedAt: Date | null;
  checked: boolean;
}> = {}) {
  return {
    id: overrides.id ?? 'task-default',
    content: overrides.content ?? 'Default task',
    description: overrides.description ?? '',
    projectId: overrides.projectId ?? 'inbox-789',
    labels: overrides.labels ?? [],
    priority: overrides.priority ?? 1,
    addedAt: overrides.addedAt ?? new Date('2024-01-01T00:00:00Z'),
    checked: overrides.checked ?? false,
  };
}

// Silence unused-import lint for createMockTodoistTask if not referenced — kept for parity with prior test surface.
void createMockTodoistTask;
