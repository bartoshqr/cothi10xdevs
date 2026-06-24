// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests/e2e",
  /* Provisions the advocate/challenger demo users before the run, deletes them after. */
  globalSetup: "./tests/e2e/global-setup.ts",
  /* Generous timeout — the chromium project's slowMo (demo pacing) adds ~1s per
     action, including each keystroke from pressSequentially, well past the 30s default. */
  timeout: 5 * 60_000,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: "http://localhost:4321",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      // viewport:null lets the *page* fill the window in headed mode, so the canvas isn't
      // clipped (a fixed preset viewport opened a window larger than the screen). We want
      // the page *content* at YouTube's 16:9 for recording, but viewport:null means the
      // page is the window minus its chrome. Measured on this machine, the chrome eats
      // 131px vertically (WM title bar + tab strip + URL bar) and 44px horizontally
      // (window borders), so a 1580x995 window yields a 1536x864 page = exactly 16:9
      // (verified), still inside the 1920x1080 screen. headless ignores the window args
      // and frameView adapts.
      use: {
        ...devices["Desktop Chrome"],
        viewport: null,
        // Desktop Chrome sets deviceScaleFactor:1, which Playwright forbids with a null
        // viewport — clear it so the page can size itself to the window.
        deviceScaleFactor: undefined,
        // slowMo paces actions for demo recording; E2E_FAST=1 zeroes it for quick verification.
        launchOptions: {
          slowMo: process.env.E2E_FAST ? 0 : 100,
          args: ["--window-position=0,0", "--window-size=1920,1080"],
        },
      },
    },

    // Firefox gated off until the first spec is green (per research: fewer flakes
    // while building this out). Re-add once chromium passes reliably.
    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },

    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: "Google Chrome",
    //   use: { ...devices["Desktop Chrome"], channel: "chrome" },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    // Disable Astro's dev toolbar for this server only (astro.config reads it), so the
    // floating pill never shows in a recording. Normal `npm run dev` keeps the toolbar.
    env: { DISABLE_DEV_TOOLBAR: "1" },
  },
});
