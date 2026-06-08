import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Load `.env`, `.env.local`, `.env.test`, `.env.test.local` (empty prefix → all keys)
// so integration tests can read SUPABASE_URL / SUPABASE_KEY (from `.env`) and the
// uncommitted SUPABASE_SERVICE_ROLE_KEY (from `.env.test`). Node reads these at test
// time; the absence guard in tests/integration/setup.ts skips the suite if they are unset.
const env = loadEnv("test", process.cwd(), "");

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/* → ./src/*` path alias so imports resolve in tests.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Surface the loaded env-file values to process.env inside the test runtime.
    env,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.{test,spec}.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.{test,spec}.ts"],
          environment: "node",
          globalSetup: ["tests/integration/globalSetup.ts"],
          setupFiles: ["tests/integration/setup.ts"],
        },
      },
    ],
  },
});
