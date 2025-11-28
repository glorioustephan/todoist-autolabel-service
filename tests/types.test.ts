/**
 * Unit tests for types.ts - Type validation and interfaces
 */

import { describe, it, expect } from 'vitest';
import type {
  Config,
  LogLevel,
  TodoistTask,
  TodoistLabel,
  TodoistProject,
  LabelDefinition,
  LabelsConfig,
  ClassificationResult,
  ClassificationRequest,
  SyncState,
  SyncResult,
  TaskStatus,
  TaskRecord,
  ErrorLogRecord,
  SyncStateRecord,
  ServiceStats,
} from '../src/types.js';
import { asTaskId, asProjectId, asLabelId } from '../src/types.js';

describe('types.ts - Type Definitions', () => {
  describe('LogLevel Type', () => {
    it('should accept valid log levels', () => {
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

      validLevels.forEach(level => {
        expect(['debug', 'info', 'warn', 'error']).toContain(level);
      });
    });
  });

  describe('Config Interface', () => {
    it('should validate Config structure', () => {
      const mockConfig: Config = {
        todoistApiToken: 'test-token',
        anthropicApiKey: 'test-key',
        anthropicModel: 'claude-haiku-4-5-20251001',
        maxLabelsPerTask: 5,
        pollIntervalMs: 15000,
        maxErrorLogs: 1000,
        dbPath: '/path/to/db',
        logLevel: 'info',
        labelsPath: '/path/to/labels.json',
      };

      // Verify all required properties exist
      expect(mockConfig.todoistApiToken).toBeDefined();
      expect(mockConfig.anthropicApiKey).toBeDefined();
      expect(mockConfig.anthropicModel).toBeDefined();
      expect(mockConfig.maxLabelsPerTask).toBeDefined();
      expect(mockConfig.pollIntervalMs).toBeDefined();
      expect(mockConfig.maxErrorLogs).toBeDefined();
      expect(mockConfig.dbPath).toBeDefined();
      expect(mockConfig.logLevel).toBeDefined();
      expect(mockConfig.labelsPath).toBeDefined();

      // Verify types
      expect(typeof mockConfig.todoistApiToken).toBe('string');
      expect(typeof mockConfig.anthropicApiKey).toBe('string');
      expect(typeof mockConfig.anthropicModel).toBe('string');
      expect(typeof mockConfig.maxLabelsPerTask).toBe('number');
      expect(typeof mockConfig.pollIntervalMs).toBe('number');
      expect(typeof mockConfig.maxErrorLogs).toBe('number');
      expect(typeof mockConfig.dbPath).toBe('string');
      expect(['debug', 'info', 'warn', 'error']).toContain(mockConfig.logLevel);
      expect(typeof mockConfig.labelsPath).toBe('string');
    });
  });

  describe('TodoistTask Interface', () => {
    it('should validate TodoistTask structure', () => {
      const mockTask: TodoistTask = {
        id: asTaskId('task-123'),
        content: 'Test task content',
        description: 'Test description',
        projectId: asProjectId('project-456'),
        labels: ['label1', 'label2'],
        priority: 2,
        createdAt: '2024-01-01T00:00:00Z',
        isCompleted: false,
      };

      expect(mockTask.id).toBeDefined();
      expect(mockTask.content).toBeDefined();
      expect(mockTask.description).toBeDefined();
      expect(mockTask.projectId).toBeDefined();
      expect(mockTask.labels).toBeDefined();
      expect(mockTask.priority).toBeDefined();
      expect(mockTask.createdAt).toBeDefined();
      expect(mockTask.isCompleted).toBeDefined();

      expect(typeof mockTask.id).toBe('string');
      expect(typeof mockTask.content).toBe('string');
      expect(typeof mockTask.description).toBe('string');
      expect(typeof mockTask.priority).toBe('number');
      expect(typeof mockTask.createdAt).toBe('string');
      expect(typeof mockTask.isCompleted).toBe('boolean');
      expect(Array.isArray(mockTask.labels)).toBe(true);
    });

    it('should allow null projectId', () => {
      const mockTask: TodoistTask = {
        id: asTaskId('task-123'),
        content: 'Test task content',
        description: 'Test description',
        projectId: null,
        labels: [],
        priority: 1,
        createdAt: '2024-01-01T00:00:00Z',
        isCompleted: false,
      };

      expect(mockTask.projectId).toBeNull();
    });
  });

  describe('TodoistLabel Interface', () => {
    it('should validate TodoistLabel structure', () => {
      const mockLabel: TodoistLabel = {
        id: asLabelId('label-123'),
        name: 'test-label',
        color: 'blue',
      };

      expect(mockLabel.id).toBeDefined();
      expect(mockLabel.name).toBeDefined();
      expect(mockLabel.color).toBeDefined();

      expect(typeof mockLabel.id).toBe('string');
      expect(typeof mockLabel.name).toBe('string');
      expect(typeof mockLabel.color).toBe('string');
    });
  });

  describe('TodoistProject Interface', () => {
    it('should validate TodoistProject structure', () => {
      const mockProject: TodoistProject = {
        id: asProjectId('project-123'),
        name: 'Test Project',
        isInboxProject: true,
      };

      expect(mockProject.id).toBeDefined();
      expect(mockProject.name).toBeDefined();
      expect(mockProject.isInboxProject).toBeDefined();

      expect(typeof mockProject.id).toBe('string');
      expect(typeof mockProject.name).toBe('string');
      expect(typeof mockProject.isInboxProject).toBe('boolean');
    });
  });

  describe('LabelDefinition Interface', () => {
    it('should validate LabelDefinition structure', () => {
      const mockLabelDef: LabelDefinition = {
        name: 'productivity',
        color: 'green',
      };

      expect(mockLabelDef.name).toBeDefined();
      expect(mockLabelDef.color).toBeDefined();

      expect(typeof mockLabelDef.name).toBe('string');
      expect(typeof mockLabelDef.color).toBe('string');
    });
  });

  describe('LabelsConfig Interface', () => {
    it('should validate LabelsConfig structure', () => {
      const mockLabelsConfig: LabelsConfig = {
        labels: [
          { name: 'productivity', color: 'green' },
          { name: 'work', color: 'blue' },
        ],
      };

      expect(mockLabelsConfig.labels).toBeDefined();
      expect(Array.isArray(mockLabelsConfig.labels)).toBe(true);
      expect(mockLabelsConfig.labels.length).toBe(2);

      mockLabelsConfig.labels.forEach(label => {
        expect(typeof label.name).toBe('string');
        expect(typeof label.color).toBe('string');
      });
    });
  });

  describe('ClassificationResult Interface', () => {
    it('should validate ClassificationResult structure', () => {
      const mockResult: ClassificationResult = {
        taskId: asTaskId('task-123'),
        labels: ['productivity', 'work'],
        confidence: 0.85,
        rawResponse: '["productivity", "work"]',
      };

      expect(mockResult.taskId).toBeDefined();
      expect(mockResult.labels).toBeDefined();
      expect(mockResult.confidence).toBeDefined();
      expect(mockResult.rawResponse).toBeDefined();

      expect(typeof mockResult.taskId).toBe('string');
      expect(Array.isArray(mockResult.labels)).toBe(true);
      expect(typeof mockResult.confidence).toBe('number');
      expect(typeof mockResult.rawResponse).toBe('string');
    });

    it('should allow optional confidence and rawResponse', () => {
      const mockResult: ClassificationResult = {
        taskId: asTaskId('task-123'),
        labels: ['productivity'],
      };

      expect(mockResult.taskId).toBeDefined();
      expect(mockResult.labels).toBeDefined();
      expect(mockResult.confidence).toBeUndefined();
      expect(mockResult.rawResponse).toBeUndefined();
    });
  });

  describe('ClassificationRequest Interface', () => {
    it('should validate ClassificationRequest structure', () => {
      const mockRequest: ClassificationRequest = {
        taskId: asTaskId('task-123'),
        content: 'Test task',
        description: 'Test description',
        availableLabels: ['productivity', 'work'],
      };

      expect(mockRequest.taskId).toBeDefined();
      expect(mockRequest.content).toBeDefined();
      expect(mockRequest.description).toBeDefined();
      expect(mockRequest.availableLabels).toBeDefined();

      expect(typeof mockRequest.taskId).toBe('string');
      expect(typeof mockRequest.content).toBe('string');
      expect(typeof mockRequest.description).toBe('string');
      expect(Array.isArray(mockRequest.availableLabels)).toBe(true);
    });
  });

  describe('SyncState Interface', () => {
    it('should validate SyncState structure', () => {
      const mockSyncState: SyncState = {
        syncToken: 'token-123',
        lastSyncAt: '2024-01-01T00:00:00Z',
        inboxProjectId: 'project-456',
      };

      expect(mockSyncState.syncToken).toBeDefined();
      expect(mockSyncState.lastSyncAt).toBeDefined();
      expect(mockSyncState.inboxProjectId).toBeDefined();

      expect(typeof mockSyncState.syncToken).toBe('string');
      expect(typeof mockSyncState.lastSyncAt).toBe('string');
      expect(typeof mockSyncState.inboxProjectId).toBe('string');
    });

    it('should allow null values', () => {
      const mockSyncState: SyncState = {
        syncToken: null,
        lastSyncAt: null,
        inboxProjectId: null,
      };

      expect(mockSyncState.syncToken).toBeNull();
      expect(mockSyncState.lastSyncAt).toBeNull();
      expect(mockSyncState.inboxProjectId).toBeNull();
    });
  });

  describe('TaskStatus Type', () => {
    it('should accept valid task statuses', () => {
      const validStatuses: TaskStatus[] = ['pending', 'classified', 'failed', 'skipped'];

      validStatuses.forEach(status => {
        expect(['pending', 'classified', 'failed', 'skipped']).toContain(status);
      });
    });
  });

  describe('TaskRecord Interface', () => {
    it('should validate TaskRecord structure', () => {
      const mockTaskRecord: TaskRecord = {
        taskId: asTaskId('task-123'),
        content: 'Test task content',
        status: 'pending',
        labels: '["productivity"]',
        attempts: 2,
        lastAttemptAt: '2024-01-01T00:00:00Z',
        classifiedAt: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(mockTaskRecord.taskId).toBeDefined();
      expect(mockTaskRecord.content).toBeDefined();
      expect(mockTaskRecord.status).toBeDefined();
      expect(mockTaskRecord.labels).toBeDefined();
      expect(mockTaskRecord.attempts).toBeDefined();
      expect(mockTaskRecord.lastAttemptAt).toBeDefined();
      expect(mockTaskRecord.classifiedAt).toBeNull();
      expect(mockTaskRecord.createdAt).toBeDefined();
      expect(mockTaskRecord.updatedAt).toBeDefined();

      expect(typeof mockTaskRecord.taskId).toBe('string');
      expect(typeof mockTaskRecord.content).toBe('string');
      expect(['pending', 'classified', 'failed', 'skipped']).toContain(mockTaskRecord.status);
      expect(typeof mockTaskRecord.labels).toBe('string');
      expect(typeof mockTaskRecord.attempts).toBe('number');
      expect(typeof mockTaskRecord.lastAttemptAt).toBe('string');
      expect(typeof mockTaskRecord.createdAt).toBe('string');
      expect(typeof mockTaskRecord.updatedAt).toBe('string');
    });

    it('should allow null labels and timestamps', () => {
      const mockTaskRecord: TaskRecord = {
        taskId: asTaskId('task-123'),
        content: 'Test task content',
        status: 'pending',
        labels: null,
        attempts: 0,
        lastAttemptAt: null,
        classifiedAt: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      expect(mockTaskRecord.labels).toBeNull();
      expect(mockTaskRecord.lastAttemptAt).toBeNull();
      expect(mockTaskRecord.classifiedAt).toBeNull();
    });
  });

  describe('ErrorLogRecord Interface', () => {
    it('should validate ErrorLogRecord structure', () => {
      const mockErrorRecord: ErrorLogRecord = {
        id: 1,
        taskId: 'task-123',
        errorType: 'CLASSIFICATION_ERROR',
        errorMessage: 'Test error message',
        stackTrace: 'Error stack trace',
        createdAt: '2024-01-01T00:00:00Z',
      };

      expect(mockErrorRecord.id).toBeDefined();
      expect(mockErrorRecord.taskId).toBeDefined();
      expect(mockErrorRecord.errorType).toBeDefined();
      expect(mockErrorRecord.errorMessage).toBeDefined();
      expect(mockErrorRecord.stackTrace).toBeDefined();
      expect(mockErrorRecord.createdAt).toBeDefined();

      expect(typeof mockErrorRecord.id).toBe('number');
      expect(typeof mockErrorRecord.taskId).toBe('string');
      expect(typeof mockErrorRecord.errorType).toBe('string');
      expect(typeof mockErrorRecord.errorMessage).toBe('string');
      expect(typeof mockErrorRecord.stackTrace).toBe('string');
      expect(typeof mockErrorRecord.createdAt).toBe('string');
    });

    it('should allow null taskId and stackTrace', () => {
      const mockErrorRecord: ErrorLogRecord = {
        id: 1,
        taskId: null,
        errorType: 'SYNC_ERROR',
        errorMessage: 'General error',
        stackTrace: null,
        createdAt: '2024-01-01T00:00:00Z',
      };

      expect(mockErrorRecord.taskId).toBeNull();
      expect(mockErrorRecord.stackTrace).toBeNull();
    });
  });

  describe('ServiceStats Interface', () => {
    it('should validate ServiceStats structure', () => {
      const mockStats: ServiceStats = {
        totalTasks: 100,
        classifiedTasks: 80,
        failedTasks: 5,
        pendingTasks: 15,
        lastSyncAt: '2024-01-01T00:00:00Z',
      };

      expect(mockStats.totalTasks).toBeDefined();
      expect(mockStats.classifiedTasks).toBeDefined();
      expect(mockStats.failedTasks).toBeDefined();
      expect(mockStats.pendingTasks).toBeDefined();
      expect(mockStats.lastSyncAt).toBeDefined();

      expect(typeof mockStats.totalTasks).toBe('number');
      expect(typeof mockStats.classifiedTasks).toBe('number');
      expect(typeof mockStats.failedTasks).toBe('number');
      expect(typeof mockStats.pendingTasks).toBe('number');
      expect(typeof mockStats.lastSyncAt).toBe('string');
    });

    it('should allow null lastSyncAt', () => {
      const mockStats: ServiceStats = {
        totalTasks: 0,
        classifiedTasks: 0,
        failedTasks: 0,
        pendingTasks: 0,
        lastSyncAt: null,
      };

      expect(mockStats.lastSyncAt).toBeNull();
    });
  });

  describe('Interface Composition', () => {
    it('should allow complex nested structures', () => {
      // Test that interfaces can be composed together
      const complexData = {
        config: {
          todoistApiToken: 'test-token',
          anthropicApiKey: 'test-key',
          anthropicModel: 'claude-haiku-4-5-20251001',
          maxLabelsPerTask: 5,
          pollIntervalMs: 15000,
          maxErrorLogs: 1000,
          dbPath: '/path/to/db',
          logLevel: 'info' as LogLevel,
          labelsPath: '/path/to/labels.json',
        } as Config,

        tasks: [
          {
            id: asTaskId('task-1'),
            content: 'First task',
            description: 'First description',
            projectId: asProjectId('inbox'),
            labels: [],
            priority: 1,
            createdAt: '2024-01-01T00:00:00Z',
            isCompleted: false,
          } as TodoistTask,
        ],

        syncResult: {
          tasks: [],
          projects: [],
          fullSync: true,
        } as SyncResult,
      };

      expect(complexData.config.logLevel).toBe('info');
      expect(complexData.tasks[0]!.id).toBe(asTaskId('task-1'));
      expect(complexData.syncResult.fullSync).toBe(true);
    });
  });
});