const { defineConfig } = require(process.env.FLASHWRIGHT_TEST_PATH ?? '@playwright/test');
module.exports = defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20000,
  expect: { timeout: 8000 },
  reporter: [['list'], ['json', { outputFile: process.env.QA_REPORT ?? 'artifacts/e2e.json' }]],
  use: {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    launchOptions: { executablePath: process.env.BROWSER_PATH || undefined },
    ...(process.env.FLASHWRIGHT_TEST_PATH
      ? { isolation: 'strict', waitForAnimations: true, failFastWhenIdle: false }
      : {}),
  },
});
