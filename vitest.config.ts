import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: [
      './tests/**/*.test.ts',
      './tests/**/*.spec.ts'
    ],
    exclude: [
      'node_modules',
      'dist',
      'docs',
      '**/node_modules/**',
      '**/.{git,cache}/**'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        'docs/',
        '**/*.d.ts',
        '**/*.config.ts',
        'ecosystem.config.cjs',
        'src/types.ts' // Type definitions don't need coverage
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 85,
          lines: 85,
          statements: 85
        }
      },
      include: ['src/**/*.ts'],
      all: true
    },
    // Optimize for performance
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    // Timeout settings
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    // File watching
    watchExclude: [
      'node_modules/**',
      'dist/**',
      'data/**',
      '**/*.db',
      '**/*.db-*'
    ],
    // Reporter configuration
    reporter: process.env.CI ? ['verbose', 'github-actions'] : ['verbose'],
    // Mock configuration
    server: {
      deps: {
        external: ['better-sqlite3']
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests')
    }
  },
  esbuild: {
    target: 'node18'
  }
});