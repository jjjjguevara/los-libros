import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Include patterns
    include: ['src/test/**/*.test.ts', 'src/test/**/*.spec.ts'],

    // Exclude patterns
    exclude: ['node_modules', 'dist', 'temp'],

    // Global test timeout (5 minutes for integration tests)
    testTimeout: 300000,

    // Hook timeout
    hookTimeout: 60000,

    // Enable globals (describe, it, expect, etc.)
    globals: true,

    // Reporter
    reporter: ['verbose'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/sync/**/*.ts', 'src/test/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/types.ts'],
    },

    // Setup files
    setupFiles: ['./src/test/setup.ts'],

    // Environment variables for testing
    env: {
      NODE_ENV: 'test',
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sync': path.resolve(__dirname, './src/sync'),
      '@test': path.resolve(__dirname, './src/test'),
      // Mock the obsidian package for tests
      'obsidian': path.resolve(__dirname, './src/test/mocks/obsidian.ts'),
    },
  },
});
