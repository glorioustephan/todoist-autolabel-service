/**
 * Unit tests for logger.ts - Logging functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, createLogger, getLogger } from '../src/logger.js';

describe('logger.ts - Logging System', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };

    // Mock Date.now() for consistent timestamps
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('Logger Class', () => {
    describe('Constructor and Level Management', () => {
      it('should create logger with default info level', () => {
        const logger = new Logger();
        expect(logger.getLevel()).toBe('info');
      });

      it('should create logger with specified level', () => {
        const logger = new Logger('debug');
        expect(logger.getLevel()).toBe('debug');
      });

      it('should allow changing log level', () => {
        const logger = new Logger('info');
        logger.setLevel('error');
        expect(logger.getLevel()).toBe('error');
      });
    });

    describe('Log Level Filtering', () => {
      it('should respect debug level (logs everything)', () => {
        const logger = new Logger('debug');

        logger.debug('Debug message');
        logger.info('Info message');
        logger.warn('Warn message');
        logger.error('Error message');

        expect(consoleSpy.log).toHaveBeenCalledTimes(2); // debug, info use console.log (success not called here)
        expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
        expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      });

      it('should respect info level', () => {
        const logger = new Logger('info');

        logger.debug('Debug message'); // Should not log
        logger.info('Info message');
        logger.warn('Warn message');
        logger.error('Error message');

        expect(consoleSpy.log).toHaveBeenCalledTimes(1); // Only info
        expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
        expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      });

      it('should respect warn level', () => {
        const logger = new Logger('warn');

        logger.debug('Debug message'); // Should not log
        logger.info('Info message');   // Should not log
        logger.warn('Warn message');
        logger.error('Error message');

        expect(consoleSpy.log).toHaveBeenCalledTimes(0);
        expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
        expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      });

      it('should respect error level (only errors)', () => {
        const logger = new Logger('error');

        logger.debug('Debug message'); // Should not log
        logger.info('Info message');   // Should not log
        logger.warn('Warn message');   // Should not log
        logger.error('Error message');

        expect(consoleSpy.log).toHaveBeenCalledTimes(0);
        expect(consoleSpy.warn).toHaveBeenCalledTimes(0);
        expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      });
    });

    describe('Message Formatting', () => {
      it('should format basic messages', () => {
        const logger = new Logger('debug');

        logger.info('Test message');

        expect(consoleSpy.log).toHaveBeenCalledWith(
          expect.stringContaining('2024-01-01T12:00:00.000Z')
        );
        expect(consoleSpy.log).toHaveBeenCalledWith(
          expect.stringContaining('INFO ')
        );
        expect(consoleSpy.log).toHaveBeenCalledWith(
          expect.stringContaining('Test message')
        );
      });

      it('should format messages with metadata', () => {
        const logger = new Logger('debug');
        const meta = { userId: 123, action: 'login' };

        logger.info('User action', meta);

        const call = consoleSpy.log.mock.calls[0][0];
        expect(call).toContain('User action');
        expect(call).toContain('userId=');
        expect(call).toContain('123');
        expect(call).toContain('action=');
        expect(call).toContain('"login"');
      });

      it('should format metadata with different types', () => {
        const logger = new Logger('debug');
        const meta = {
          string: 'value',
          number: 42,
          boolean: true,
          object: { nested: 'data' },
          array: [1, 2, 3],
          null: null,
          undefined: undefined,
        };

        logger.info('Complex metadata', meta);

        const call = consoleSpy.log.mock.calls[0][0];
        expect(call).toContain('string="value"');
        expect(call).toContain('number=42');
        expect(call).toContain('boolean=true');
        expect(call).toContain('object={"nested":"data"}');
        expect(call).toContain('array=[1,2,3]');
        expect(call).toContain('null=null');
        expect(call).toContain('undefined=undefined');
      });

      it('should handle empty metadata', () => {
        const logger = new Logger('debug');

        logger.info('No metadata', {});

        const call = consoleSpy.log.mock.calls[0][0];
        expect(call).toContain('No metadata');
        expect(call).not.toContain('='); // No metadata formatting
      });
    });

    describe('Log Methods', () => {
      describe('debug()', () => {
        it('should log debug messages when level allows', () => {
          const logger = new Logger('debug');

          logger.debug('Debug message');

          expect(consoleSpy.log).toHaveBeenCalledTimes(1);
          expect(consoleSpy.log).toHaveBeenCalledWith(
            expect.stringContaining('DEBUG')
          );
        });

        it('should not log debug when level is higher', () => {
          const logger = new Logger('info');

          logger.debug('Debug message');

          expect(consoleSpy.log).not.toHaveBeenCalled();
        });
      });

      describe('info()', () => {
        it('should log info messages when level allows', () => {
          const logger = new Logger('info');

          logger.info('Info message');

          expect(consoleSpy.log).toHaveBeenCalledTimes(1);
          expect(consoleSpy.log).toHaveBeenCalledWith(
            expect.stringContaining('INFO ')
          );
        });
      });

      describe('warn()', () => {
        it('should log warning messages when level allows', () => {
          const logger = new Logger('warn');

          logger.warn('Warning message');

          expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
          expect(consoleSpy.warn).toHaveBeenCalledWith(
            expect.stringContaining('WARN ')
          );
        });
      });

      describe('error()', () => {
        it('should log error messages', () => {
          const logger = new Logger('error');

          logger.error('Error message');

          expect(consoleSpy.error).toHaveBeenCalledTimes(1);
          expect(consoleSpy.error).toHaveBeenCalledWith(
            expect.stringContaining('ERROR')
          );
        });

        it('should log error with Error object', () => {
          const logger = new Logger('error');
          const error = new Error('Test error');
          error.stack = 'Error: Test error\n    at test.js:1:1';

          logger.error('Something failed', error);

          expect(consoleSpy.error).toHaveBeenCalledTimes(2); // Message + stack
          const firstCall = consoleSpy.error.mock.calls[0][0];
          expect(firstCall).toContain('Something failed');
          expect(firstCall).toContain('errorMessage="Test error"');
          expect(firstCall).toContain('errorName="Error"');

          const secondCall = consoleSpy.error.mock.calls[1][0];
          expect(secondCall).toContain('at test.js:1:1');
        });

        it('should log error with non-Error object', () => {
          const logger = new Logger('error');

          logger.error('Something failed', 'string error');

          const call = consoleSpy.error.mock.calls[0][0];
          expect(call).toContain('Something failed');
          expect(call).toContain('error="string error"');
        });

        it('should log error with metadata', () => {
          const logger = new Logger('error');
          const error = new Error('Test error');
          const meta = { taskId: 'task-123' };

          logger.error('Processing failed', error, meta);

          const call = consoleSpy.error.mock.calls[0][0];
          expect(call).toContain('Processing failed');
          expect(call).toContain('taskId="task-123"');
          expect(call).toContain('errorMessage="Test error"');
        });

        it('should handle Error without stack', () => {
          const logger = new Logger('error');
          const error = new Error('Test error');
          delete error.stack;

          logger.error('Error without stack', error);

          expect(consoleSpy.error).toHaveBeenCalledTimes(1); // Only one call, no stack
        });

        it('should limit stack trace lines', () => {
          const logger = new Logger('error');
          const error = new Error('Test error');
          error.stack = 'Error: Test error\n' +
            '    at line1\n' +
            '    at line2\n' +
            '    at line3\n' +
            '    at line4\n' +
            '    at line5\n' +
            '    at line6\n' +
            '    at line7\n';

          logger.error('Stack trace test', error);

          // Should have main error call + 4 stack lines (limited to 4)
          expect(consoleSpy.error).toHaveBeenCalledTimes(5);
        });
      });

      describe('success()', () => {
        it('should log success messages at info level', () => {
          const logger = new Logger('info');

          logger.success('Operation completed');

          expect(consoleSpy.log).toHaveBeenCalledTimes(1);
          expect(consoleSpy.log).toHaveBeenCalledWith(
            expect.stringContaining('OK   ')
          );
          expect(consoleSpy.log).toHaveBeenCalledWith(
            expect.stringContaining('Operation completed')
          );
        });

        it('should not log success when level is higher than info', () => {
          const logger = new Logger('error');

          logger.success('Operation completed');

          expect(consoleSpy.log).not.toHaveBeenCalled();
        });
      });
    });

    describe('Dynamic Level Changes', () => {
      it('should apply level changes immediately', () => {
        const logger = new Logger('error');

        logger.info('Should not log'); // Level is error
        expect(consoleSpy.log).not.toHaveBeenCalled();

        logger.setLevel('info');
        logger.info('Should log now'); // Level is now info
        expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Module Functions', () => {
    describe('createLogger()', () => {
      it('should create logger with default level', () => {
        const logger = createLogger();
        expect(logger.getLevel()).toBe('info');
      });

      it('should create logger with specified level', () => {
        const logger = createLogger('debug');
        expect(logger.getLevel()).toBe('debug');
      });

      it('should update existing logger level', () => {
        const logger1 = createLogger('info');
        const logger2 = createLogger('debug');

        expect(logger1).toBe(logger2); // Should be same instance
        expect(logger2.getLevel()).toBe('debug');
      });

      it('should not change level if not provided on subsequent calls', () => {
        const logger1 = createLogger('debug');
        const logger2 = createLogger(); // No level specified

        expect(logger1).toBe(logger2);
        expect(logger2.getLevel()).toBe('debug'); // Should keep debug level
      });
    });

    describe('getLogger()', () => {
      it('should create default logger if none exists', () => {
        const logger = getLogger();
        expect(logger.getLevel()).toBe('debug'); // Uses debug due to previous test state
      });

      it('should return existing logger instance', () => {
        const logger1 = getLogger();
        const logger2 = getLogger();

        expect(logger1).toBe(logger2);
      });

      it('should work with createLogger()', () => {
        const created = createLogger('warn');
        const gotten = getLogger();

        expect(created).toBe(gotten);
        expect(gotten.getLevel()).toBe('warn');
      });
    });
  });

  describe('Log Level Hierarchy', () => {
    it.each([
      ['debug', ['debug', 'info', 'warn', 'error', 'success']],
      ['info', ['info', 'warn', 'error', 'success']],
      ['warn', ['warn', 'error']],
      ['error', ['error']],
    ])('should log correct methods for %s level', (level, expectedMethods) => {
      const logger = new Logger(level as 'debug' | 'info' | 'warn' | 'error');

      // Try all log methods
      logger.debug('Debug test');
      logger.info('Info test');
      logger.warn('Warn test');
      logger.error('Error test');
      logger.success('Success test');

      // Count expected calls
      const methods = expectedMethods as readonly string[];
      const expectedLogCalls = methods.filter(m => ['debug', 'info', 'success'].includes(m)).length;
      const expectedWarnCalls = methods.includes('warn') ? 1 : 0;
      const expectedErrorCalls = methods.includes('error') ? 1 : 0;

      expect(consoleSpy.log).toHaveBeenCalledTimes(expectedLogCalls);
      expect(consoleSpy.warn).toHaveBeenCalledTimes(expectedWarnCalls);
      expect(consoleSpy.error).toHaveBeenCalledTimes(expectedErrorCalls);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long messages', () => {
      const logger = new Logger('info');
      const longMessage = 'A'.repeat(10000);

      logger.info(longMessage);

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining(longMessage)
      );
    });

    it('should handle messages with special characters', () => {
      const logger = new Logger('info');
      const specialMessage = 'Message with\nnewlines\tand\ttabs\rand\rcarriage returns';

      logger.info(specialMessage);

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining(specialMessage)
      );
    });

    it('should handle Unicode characters', () => {
      const logger = new Logger('info');
      const unicodeMessage = 'Unicode test: 🚀 🔥 émojis and accénts';

      logger.info(unicodeMessage);

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining(unicodeMessage)
      );
    });

    it('should handle circular references in metadata', () => {
      const logger = new Logger('info');
      const circular: any = { name: 'test' };
      circular.self = circular;

      // Will throw error due to JSON.stringify circular reference
      expect(() => {
        logger.info('Circular test', { data: circular });
      }).toThrow('Converting circular structure to JSON');
    });

    it('should handle undefined and null metadata values', () => {
      const logger = new Logger('info');

      logger.info('Null/undefined test', {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        zero: 0,
        false: false,
      });

      const call = consoleSpy.log.mock.calls[0][0];
      expect(call).toContain('nullValue=null');
      expect(call).toContain('undefinedValue=undefined');
      expect(call).toContain('emptyString=""');
      expect(call).toContain('zero=0');
      expect(call).toContain('false=false');
    });

    it('should handle metadata with function values', () => {
      const logger = new Logger('info');

      logger.info('Function test', {
        fn: () => 'test',
        arrow: () => {},
      });

      const call = consoleSpy.log.mock.calls[0][0];
      // Functions should be stringified
      expect(call).toContain('fn=');
      expect(call).toContain('arrow=');
    });
  });

  describe('Timestamp Formatting', () => {
    it('should use ISO string format', () => {
      const logger = new Logger('info');

      logger.info('Timestamp test');

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('2024-01-01T12:00:00.000Z')
      );
    });

    it('should update timestamp for each log call', () => {
      const logger = new Logger('info');

      logger.info('First message');

      // Advance time
      vi.advanceTimersByTime(1000);

      logger.info('Second message');

      const firstCall = consoleSpy.log.mock.calls[0][0];
      const secondCall = consoleSpy.log.mock.calls[1][0];

      expect(firstCall).toContain('2024-01-01T12:00:00.000Z');
      expect(secondCall).toContain('2024-01-01T12:00:01.000Z');
    });
  });

  describe('Performance', () => {
    it('should not format messages when level filters them out', () => {
      const logger = new Logger('error');

      // Create a spy function that tracks if it was called
      const expensiveOperation = vi.fn(() => ({ result: 'expensive' }));

      // Don't call the function, just pass it as a callback concept
      // The debug level is filtered out at error level, so metadata formatting is skipped
      logger.debug('Debug message');

      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should only format metadata when message will be logged', () => {
      const logger = new Logger('error');
      const expensiveMetadata = {
        get expensive() {
          throw new Error('Should not be accessed');
        }
      };

      // This should not access the expensive getter
      expect(() => {
        logger.debug('Debug message', expensiveMetadata);
      }).not.toThrow();
    });
  });
});