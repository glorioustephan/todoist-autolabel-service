/**
 * Unit tests for config.ts - Configuration loading and validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, getConfig, resetConfig } from '../src/config.js';
import { withTestEnv, clearTestEnv, setTestEnv } from './test-utils.js';
import type { Config, LogLevel } from '../src/types.js';

// Mock dotenv to control environment loading
vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

describe('config.ts - Configuration Management', () => {
  beforeEach(() => {
    // Reset config singleton before each test
    resetConfig();

    // Clear potentially conflicting env vars
    clearTestEnv([
      'TODOIST_API_TOKEN',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'MAX_LABELS_PER_TASK',
      'POLL_INTERVAL_MS',
      'MAX_ERROR_LOGS',
      'DB_PATH',
      'LOG_LEVEL',
    ]);
  });

  afterEach(() => {
    resetConfig();
  });

  describe('loadConfig', () => {
    it('should load configuration with required environment variables', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-todoist-token',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
      };

      const config = withTestEnv(testEnv, () => loadConfig());

      expect(config.todoistApiToken).toBe('test-todoist-token');
      expect(config.anthropicApiKey).toBe('test-anthropic-key');

      // Verify defaults
      expect(config.anthropicModel).toBe('claude-haiku-4-5-20251001');
      expect(config.maxLabelsPerTask).toBe(5);
      expect(config.pollIntervalMs).toBe(15000);
      expect(config.maxErrorLogs).toBe(1000);
      expect(config.logLevel).toBe('info');
      expect(config.dbPath).toContain('data/todoist.db');
      expect(config.labelsPath).toContain('labels.json');
    });

    it('should use custom values when provided', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'custom-todoist-token',
        ANTHROPIC_API_KEY: 'custom-anthropic-key',
        ANTHROPIC_MODEL: 'claude-opus-3',
        MAX_LABELS_PER_TASK: '10',
        POLL_INTERVAL_MS: '30000',
        MAX_ERROR_LOGS: '500',
        DB_PATH: '/custom/path/to/db.sqlite',
        LOG_LEVEL: 'debug',
      };

      const config = withTestEnv(testEnv, () => loadConfig());

      expect(config.todoistApiToken).toBe('custom-todoist-token');
      expect(config.anthropicApiKey).toBe('custom-anthropic-key');
      expect(config.anthropicModel).toBe('claude-opus-3');
      expect(config.maxLabelsPerTask).toBe(10);
      expect(config.pollIntervalMs).toBe(30000);
      expect(config.maxErrorLogs).toBe(500);
      expect(config.dbPath).toBe('/custom/path/to/db.sqlite');
      expect(config.logLevel).toBe('debug');
    });

    it('should throw error when TODOIST_API_TOKEN is missing', () => {
      const testEnv = {
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        // TODOIST_API_TOKEN is intentionally missing
      };

      expect(() => {
        withTestEnv(testEnv, () => loadConfig());
      }).toThrow('TODOIST_API_TOKEN environment variable is not set');
    });

    it('should throw error when ANTHROPIC_API_KEY is missing', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-todoist-token',
        // ANTHROPIC_API_KEY is intentionally missing
      };

      expect(() => {
        withTestEnv(testEnv, () => loadConfig());
      }).toThrow('ANTHROPIC_API_KEY environment variable is not set');
    });

    it('should throw error for invalid numeric values', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-todoist-token',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MAX_LABELS_PER_TASK: 'not-a-number',
      };

      expect(() => {
        withTestEnv(testEnv, () => loadConfig());
      }).toThrow('MAX_LABELS_PER_TASK must be a valid number');
    });

    it('should throw error for invalid log level', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-todoist-token',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        LOG_LEVEL: 'invalid-level',
      };

      expect(() => {
        withTestEnv(testEnv, () => loadConfig());
      }).toThrow('Invalid LOG_LEVEL: invalid-level. Must be one of: debug, info, warn, error');
    });

    it('should validate all log levels', () => {
      const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

      for (const level of validLevels) {
        const testEnv = {
          TODOIST_API_TOKEN: 'test-todoist-token',
          ANTHROPIC_API_KEY: 'test-anthropic-key',
          LOG_LEVEL: level,
        };

        const config = withTestEnv(testEnv, () => loadConfig());
        expect(config.logLevel).toBe(level);
      }
    });

    it('should handle zero values for numeric configs', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-todoist-token',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MAX_LABELS_PER_TASK: '0',
        POLL_INTERVAL_MS: '0',
        MAX_ERROR_LOGS: '0',
      };

      const config = withTestEnv(testEnv, () => loadConfig());

      expect(config.maxLabelsPerTask).toBe(0);
      expect(config.pollIntervalMs).toBe(0);
      expect(config.maxErrorLogs).toBe(0);
    });

    it('should handle negative values for numeric configs', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-todoist-token',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        MAX_LABELS_PER_TASK: '-5',
        POLL_INTERVAL_MS: '-1000',
        MAX_ERROR_LOGS: '-100',
      };

      const config = withTestEnv(testEnv, () => loadConfig());

      expect(config.maxLabelsPerTask).toBe(-5);
      expect(config.pollIntervalMs).toBe(-1000);
      expect(config.maxErrorLogs).toBe(-100);
    });

    it('should generate correct file paths', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-todoist-token',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
      };

      const config = withTestEnv(testEnv, () => loadConfig());

      // DB path should be in project root/data directory
      expect(config.dbPath).toContain('data');
      expect(config.dbPath).toContain('todoist.db');
      expect(config.dbPath.startsWith('/')).toBe(true); // Should be absolute path

      // Labels path should be in project root
      expect(config.labelsPath).toContain('labels.json');
      expect(config.labelsPath.startsWith('/')).toBe(true); // Should be absolute path
    });
  });

  describe('getConfig', () => {
    it('should return singleton instance', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-todoist-token',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
      };

      withTestEnv(testEnv, () => {
        const config1 = getConfig();
        const config2 = getConfig();

        expect(config1).toBe(config2); // Should be same instance
        expect(config1.todoistApiToken).toBe('test-todoist-token');
      });
    });

    it('should load config on first call', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-todoist-token',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        LOG_LEVEL: 'warn',
      };

      withTestEnv(testEnv, () => {
        const config = getConfig();

        expect(config.todoistApiToken).toBe('test-todoist-token');
        expect(config.anthropicApiKey).toBe('test-anthropic-key');
        expect(config.logLevel).toBe('warn');
      });
    });

    it('should cache config after first load', () => {
      setTestEnv({
        TODOIST_API_TOKEN: 'initial-token',
        ANTHROPIC_API_KEY: 'initial-key',
      });

      const config1 = getConfig();

      // Change environment variables after first load
      setTestEnv({
        TODOIST_API_TOKEN: 'changed-token',
        ANTHROPIC_API_KEY: 'changed-key',
      });

      const config2 = getConfig();

      // Should still return cached config with initial values
      expect(config1).toBe(config2);
      expect(config2.todoistApiToken).toBe('initial-token');
      expect(config2.anthropicApiKey).toBe('initial-key');
    });
  });

  describe('resetConfig', () => {
    it('should reset singleton and allow reloading', () => {
      setTestEnv({
        TODOIST_API_TOKEN: 'initial-token',
        ANTHROPIC_API_KEY: 'initial-key',
        LOG_LEVEL: 'debug',
      });

      const config1 = getConfig();
      expect(config1.logLevel).toBe('debug');

      // Reset and change environment
      resetConfig();
      setTestEnv({
        TODOIST_API_TOKEN: 'new-token',
        ANTHROPIC_API_KEY: 'new-key',
        LOG_LEVEL: 'error',
      });

      const config2 = getConfig();

      expect(config1).not.toBe(config2); // Should be different instances
      expect(config2.todoistApiToken).toBe('new-token');
      expect(config2.logLevel).toBe('error');
    });

    it('should allow multiple resets', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-token',
        ANTHROPIC_API_KEY: 'test-key',
      };

      withTestEnv(testEnv, () => {
        getConfig(); // Load config
        resetConfig(); // Reset
        resetConfig(); // Reset again (should not throw)

        const config = getConfig(); // Load again
        expect(config.todoistApiToken).toBe('test-token');
      });
    });
  });

  describe('Configuration Validation', () => {
    describe('requireEnv validation', () => {
      it('should handle empty strings as missing', () => {
        const testEnv = {
          TODOIST_API_TOKEN: '', // Empty string
          ANTHROPIC_API_KEY: 'test-key',
        };

        expect(() => {
          withTestEnv(testEnv, () => loadConfig());
        }).toThrow('TODOIST_API_TOKEN environment variable is not set');
      });

      it('should handle whitespace-only strings as valid', () => {
        const testEnv = {
          TODOIST_API_TOKEN: '   ', // Whitespace only
          ANTHROPIC_API_KEY: 'test-key',
        };

        const config = withTestEnv(testEnv, () => loadConfig());
        expect(config.todoistApiToken).toBe('   ');
      });
    });

    describe('getEnvNumber validation', () => {
      it('should handle floating point numbers', () => {
        const testEnv = {
          TODOIST_API_TOKEN: 'test-token',
          ANTHROPIC_API_KEY: 'test-key',
          POLL_INTERVAL_MS: '15.5', // Float as string
        };

        const config = withTestEnv(testEnv, () => loadConfig());
        expect(config.pollIntervalMs).toBe(15); // parseInt truncates
      });

      it('should handle numbers with leading/trailing whitespace', () => {
        const testEnv = {
          TODOIST_API_TOKEN: 'test-token',
          ANTHROPIC_API_KEY: 'test-key',
          MAX_LABELS_PER_TASK: ' 7 ', // Whitespace around number
        };

        const config = withTestEnv(testEnv, () => loadConfig());
        expect(config.maxLabelsPerTask).toBe(7);
      });

      it('should reject non-numeric strings', () => {
        const testEnv = {
          TODOIST_API_TOKEN: 'test-token',
          ANTHROPIC_API_KEY: 'test-key',
          POLL_INTERVAL_MS: 'abc', // Completely invalid number
        };

        expect(() => {
          withTestEnv(testEnv, () => loadConfig());
        }).toThrow('POLL_INTERVAL_MS must be a valid number');
      });
    });

    describe('validateLogLevel validation', () => {
      it('should be case sensitive', () => {
        const testEnv = {
          TODOIST_API_TOKEN: 'test-token',
          ANTHROPIC_API_KEY: 'test-key',
          LOG_LEVEL: 'INFO', // Uppercase
        };

        expect(() => {
          withTestEnv(testEnv, () => loadConfig());
        }).toThrow('Invalid LOG_LEVEL: INFO');
      });

      it('should reject partial matches', () => {
        const testEnv = {
          TODOIST_API_TOKEN: 'test-token',
          ANTHROPIC_API_KEY: 'test-key',
          LOG_LEVEL: 'inf', // Partial match
        };

        expect(() => {
          withTestEnv(testEnv, () => loadConfig());
        }).toThrow('Invalid LOG_LEVEL: inf');
      });
    });
  });

  describe('Integration with actual environment', () => {
    it('should work with process.env directly', () => {
      // Temporarily set real process.env values
      const originalToken = process.env.TODOIST_API_TOKEN;
      const originalKey = process.env.ANTHROPIC_API_KEY;

      try {
        process.env.TODOIST_API_TOKEN = 'direct-test-token';
        process.env.ANTHROPIC_API_KEY = 'direct-test-key';

        resetConfig();
        const config = loadConfig();

        expect(config.todoistApiToken).toBe('direct-test-token');
        expect(config.anthropicApiKey).toBe('direct-test-key');
      } finally {
        // Restore original values
        if (originalToken !== undefined) {
          process.env.TODOIST_API_TOKEN = originalToken;
        } else {
          delete process.env.TODOIST_API_TOKEN;
        }
        if (originalKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large numeric values', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-token',
        ANTHROPIC_API_KEY: 'test-key',
        POLL_INTERVAL_MS: '999999999999',
        MAX_LABELS_PER_TASK: '2147483647', // Max 32-bit int
      };

      const config = withTestEnv(testEnv, () => loadConfig());
      expect(config.pollIntervalMs).toBe(999999999999);
      expect(config.maxLabelsPerTask).toBe(2147483647);
    });

    it('should handle special characters in paths', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'test-token',
        ANTHROPIC_API_KEY: 'test-key',
        DB_PATH: '/path with spaces/special-chars!@#$%/db.sqlite',
      };

      const config = withTestEnv(testEnv, () => loadConfig());
      expect(config.dbPath).toBe('/path with spaces/special-chars!@#$%/db.sqlite');
    });

    it('should handle Unicode characters in environment variables', () => {
      const testEnv = {
        TODOIST_API_TOKEN: 'token-with-unicode-🚀',
        ANTHROPIC_API_KEY: 'key-with-émojis-🔑',
      };

      const config = withTestEnv(testEnv, () => loadConfig());
      expect(config.todoistApiToken).toBe('token-with-unicode-🚀');
      expect(config.anthropicApiKey).toBe('key-with-émojis-🔑');
    });
  });
});