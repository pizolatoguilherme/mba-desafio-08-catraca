import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    // Os arquivos compartilham um único banco (resetDb faz TRUNCATE): rodam em série.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { LOG_LEVEL: 'silent' },
  },
});
