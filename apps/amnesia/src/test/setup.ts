/**
 * Vitest Test Setup
 *
 * This file runs before all tests to set up the test environment.
 */

// Environment variable validation
function validateEnv(): void {
  const requiredForLiveTests = [
    'CALIBRE_SERVER_URL',
  ];

  const optionalEnvVars = [
    'CALIBRE_USERNAME',
    'CALIBRE_PASSWORD',
    'CALIBRE_LIBRARY',
    'CALIBRE_TEST_LIBRARY_PATH',
    'VERBOSE',
    'CI',
  ];

  // Only warn about missing env vars if we're not in a browser context
  if (typeof process !== 'undefined' && process.env) {
    // Log environment info
    console.log('Test Environment:');
    console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
    console.log(`  CI: ${process.env.CI || 'false'}`);
    console.log(`  CALIBRE_SERVER_URL: ${process.env.CALIBRE_SERVER_URL || 'http://localhost:8080 (default)'}`);

    // Check for test library path
    if (!process.env.CALIBRE_TEST_LIBRARY_PATH) {
      console.log('  CALIBRE_TEST_LIBRARY_PATH: not set (live Calibre tests will use default)');
    }
  }
}

// Run validation
try {
  validateEnv();
} catch (error) {
  console.error('Environment validation failed:', error);
}

// Mock crypto.randomUUID if not available (Node < 19)
if (typeof crypto === 'undefined' || !crypto.randomUUID) {
  // @ts-expect-error - polyfill for older Node versions
  globalThis.crypto = {
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },
  };
}

export {};
