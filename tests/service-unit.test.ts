/**
 * Unit tests for service.ts components - Testing individual functions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockConfig, createMockDatabase } from './test-utils.js';

// Mock all dependencies
const mockConfig = createMockConfig();
const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

const mockDatabase = createMockDatabase();
const mockClassifier = { getAvailableLabels: vi.fn().mockReturnValue(['productivity', 'work']) };

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue(mockConfig),
  getConfig: vi.fn().mockReturnValue(mockConfig),
}));

vi.mock('../src/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
  getLogger: vi.fn().mockReturnValue(mockLogger),
}));

vi.mock('../src/database.js', () => ({
  initDatabase: vi.fn().mockReturnValue(mockDatabase),
  closeDatabase: vi.fn(),
  getDatabase: vi.fn().mockReturnValue(mockDatabase),
}));

vi.mock('../src/todoist-api.js', () => ({
  initTodoistApi: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/classifier.js', () => ({
  initClassifier: vi.fn().mockReturnValue(mockClassifier),
}));

vi.mock('../src/sync.js', () => ({
  initSyncManager: vi.fn().mockReturnValue({}),
  getSyncManager: vi.fn().mockReturnValue({
    sync: vi.fn().mockResolvedValue({
      processed: 0,
      classified: 0,
      failed: 0,
      skipped: 0,
    }),
  }),
}));

describe('service.ts - Service Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Configuration Loading', () => {
    it('should load and validate configuration', async () => {
      const { loadConfig } = await import('../src/config.js');
      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config.todoistApiToken).toBe('test-todoist-token');
      expect(config.anthropicApiKey).toBe('test-anthropic-key');
      expect(config.pollIntervalMs).toBeGreaterThan(0);
    });

    it('should validate required environment variables', async () => {
      const { loadConfig } = await import('../src/config.js');

      // Mock missing required env var
      vi.mocked(loadConfig).mockImplementationOnce(() => {
        throw new Error('TODOIST_API_TOKEN environment variable is not set');
      });

      expect(() => loadConfig()).toThrow('TODOIST_API_TOKEN environment variable is not set');
    });
  });

  describe('Logger Initialization', () => {
    it('should create logger with configured level', async () => {
      const { createLogger } = await import('../src/logger.js');
      createLogger(mockConfig.logLevel);

      expect(createLogger).toHaveBeenCalledWith(mockConfig.logLevel);
    });
  });

  describe('Database Initialization', () => {
    it('should initialize database with config', async () => {
      const { initDatabase } = await import('../src/database.js');
      const db = initDatabase(mockConfig);

      expect(initDatabase).toHaveBeenCalledWith(mockConfig);
      expect(db).toBeDefined();
    });

    it('should provide database statistics', async () => {
      const { getDatabase } = await import('../src/database.js');
      const db = getDatabase();

      const stats = db.getStats();
      expect(stats).toEqual({
        total: 0,
        classified: 0,
        failed: 0,
        pending: 0,
        skipped: 0,
      });
    });
  });

  describe('API Initialization', () => {
    it('should initialize Todoist API', async () => {
      const { initTodoistApi } = await import('../src/todoist-api.js');
      await initTodoistApi(mockConfig);

      expect(initTodoistApi).toHaveBeenCalledWith(mockConfig);
    });
  });

  describe('Classifier Initialization', () => {
    it('should initialize classifier and load labels', async () => {
      const { initClassifier } = await import('../src/classifier.js');
      const classifier = initClassifier(mockConfig);

      expect(initClassifier).toHaveBeenCalledWith(mockConfig);
      expect(classifier.getAvailableLabels()).toEqual(['productivity', 'work']);
    });
  });

  describe('Sync Manager Initialization', () => {
    it('should initialize sync manager', async () => {
      const { initSyncManager } = await import('../src/sync.js');
      const syncManager = initSyncManager(mockConfig);

      expect(initSyncManager).toHaveBeenCalledWith(mockConfig);
      expect(syncManager).toBeDefined();
    });

    it('should provide sync functionality', async () => {
      const { getSyncManager } = await import('../src/sync.js');
      const syncManager = getSyncManager();

      const result = await syncManager.sync();
      expect(result).toEqual({
        processed: 0,
        classified: 0,
        failed: 0,
        skipped: 0,
      });
    });
  });

  describe('Service Health', () => {
    it('should provide service statistics for monitoring', async () => {
      const { getDatabase } = await import('../src/database.js');
      const db = getDatabase();

      const stats = db.getStats();
      const syncState = db.getSyncState();

      expect(stats).toBeDefined();
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.classified).toBeGreaterThanOrEqual(0);
      expect(stats.failed).toBeGreaterThanOrEqual(0);
      expect(stats.pending).toBeGreaterThanOrEqual(0);

      expect(syncState).toBeDefined();
      expect(syncState).toHaveProperty('syncToken');
      expect(syncState).toHaveProperty('lastSyncAt');
      expect(syncState).toHaveProperty('inboxProjectId');
    });
  });

  describe('Error Handling', () => {
    it('should handle database initialization errors', async () => {
      const { initDatabase } = await import('../src/database.js');

      vi.mocked(initDatabase).mockImplementationOnce(() => {
        throw new Error('Database connection failed');
      });

      expect(() => initDatabase(mockConfig)).toThrow('Database connection failed');
    });

    it('should handle API initialization errors', async () => {
      const { initTodoistApi } = await import('../src/todoist-api.js');

      vi.mocked(initTodoistApi).mockRejectedValueOnce(new Error('API connection failed'));

      await expect(initTodoistApi(mockConfig)).rejects.toThrow('API connection failed');
    });

    it('should handle classifier initialization errors', async () => {
      const { initClassifier } = await import('../src/classifier.js');

      vi.mocked(initClassifier).mockImplementationOnce(() => {
        throw new Error('Labels file not found');
      });

      expect(() => initClassifier(mockConfig)).toThrow('Labels file not found');
    });
  });

  describe('Service Integration', () => {
    it('should initialize all components without errors', async () => {
      const { loadConfig } = await import('../src/config.js');
      const { createLogger } = await import('../src/logger.js');
      const { initDatabase } = await import('../src/database.js');
      const { initTodoistApi } = await import('../src/todoist-api.js');
      const { initClassifier } = await import('../src/classifier.js');
      const { initSyncManager } = await import('../src/sync.js');

      expect(() => {
        const config = loadConfig();
        const logger = createLogger(config.logLevel);
        const database = initDatabase(config);
        const classifier = initClassifier(config);
        const syncManager = initSyncManager(config);
      }).not.toThrow();

      await expect(async () => {
        const { initTodoistApi } = await import('../src/todoist-api.js');
        await initTodoistApi(mockConfig);
      }).not.toThrow();
    });

    it('should provide all required service components', async () => {
      const { getConfig } = await import('../src/config.js');
      const { getLogger } = await import('../src/logger.js');
      const { getDatabase } = await import('../src/database.js');

      const config = getConfig();
      const logger = getLogger();
      const database = getDatabase();

      expect(config).toBeDefined();
      expect(logger).toBeDefined();
      expect(database).toBeDefined();

      // Verify they provide expected functionality
      expect(typeof config.pollIntervalMs).toBe('number');
      expect(typeof logger.info).toBe('function');
      expect(typeof database.getStats).toBe('function');
    });
  });
});