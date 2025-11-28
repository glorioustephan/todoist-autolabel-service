/**
 * Test setup configuration for Todoist Autolabel Service
 */

import { vi } from 'vitest';

// Mock console methods to reduce noise during tests
const consoleMethods = ['log', 'info', 'warn', 'error'] as const;
const originalConsole = {} as Record<typeof consoleMethods[number], typeof console.log>;

// Store original console methods
consoleMethods.forEach((method) => {
  originalConsole[method] = console[method];
});

// Set up global test configuration
beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks();

  // Reset timers
  vi.useRealTimers();

  // Mock console to reduce test output noise
  consoleMethods.forEach((method) => {
    vi.spyOn(console, method).mockImplementation(() => {});
  });
});

afterEach(() => {
  // Restore console methods after each test
  consoleMethods.forEach((method) => {
    vi.mocked(console[method]).mockRestore();
  });

  // Clean up any remaining timers
  vi.useRealTimers();
});

// Set up process.env defaults for testing
process.env.NODE_ENV = 'test';
process.env.TODOIST_API_TOKEN = 'test-todoist-token';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';