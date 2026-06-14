// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// Pre-bundle these for the SSR/workerd environment in ONE pass at startup, so Vite
// never discovers them lazily and reloads the worker mid-render. Lazy discovery is
// what splits react / react-dom across optimize passes and produces the cascade of
// "jsxDEV is not a function" and null-dispatcher invalid-hook-call SSR crashes under
// Astro 6 + @cloudflare/vite-plugin (dev runs inside workerd).
const SERVER_OPTIMIZE_DEPS = [
  "react",
  "react-dom",
  "react-dom/server.edge",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "lucide-react",
  "@radix-ui/react-slot",
  "@xyflow/react",
  "zustand",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "zod",
];

// Under @cloudflare/vite-plugin, SSR is its OWN Vite environment and the top-level
// vite.optimizeDeps / vite.ssr.optimizeDeps never reach it. The configEnvironment hook
// is the documented way to configure that environment's optimizer (name !== "client"
// covers the workerd/SSR graph).
function optimizeServerDeps() {
  return {
    name: "optimize-server-deps",
    /** @param {string} name */
    configEnvironment(name) {
      if (name !== "client") {
        return { optimizeDeps: { include: SERVER_OPTIMIZE_DEPS } };
      }
    },
  };
}

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss(), optimizeServerDeps()],
    resolve: {
      // Keep a single React instance across the client and worker graphs.
      dedupe: ["react", "react-dom"],
      // Force the Web-Streams ("edge") build of react-dom/server everywhere. Dev now
      // runs in workerd, so it needs the edge build in dev too — the node build is what
      // throws "jsxDEV is not a function" under workerd.
      alias: { "react-dom/server": "react-dom/server.edge" },
    },
    // Also pre-bundle the same list for the client (browser) graph so it doesn't churn.
    optimizeDeps: {
      include: SERVER_OPTIMIZE_DEPS,
    },
  },
  adapter: cloudflare({
    imageService: "passthrough",
  }),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
