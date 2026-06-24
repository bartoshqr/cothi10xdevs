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
  // Astro internal backing the `astro:env` secrets we declare below. Without this it is
  // discovered lazily on the first SSR request, triggering a worker reload mid-render that
  // nulls React's hook dispatcher — the last remaining source of the invalid-hook-call crash.
  "astro/env/runtime",
];

// React and every React-consuming island, by bare package name. These must NOT be
// externalized in the worker graph: an externalized copy (raw from node_modules) plus the
// pre-bundled copy = two React instances. After a worker reload ("program reload" from HMR,
// e.g. a CSS regen) react-dom/server re-runs and sets its dispatcher on the bundled copy,
// while a still-externalized lucide-react reads the OTHER copy's null dispatcher → the
// "Cannot read properties of null (reading 'useContext')" crash. noExternal forces one copy.
const SERVER_NO_EXTERNAL = [
  "react",
  "react-dom",
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
// vite.optimizeDeps / vite.ssr.* / vite.resolve never reach it. The configEnvironment hook
// is the documented way to configure that environment (name !== "client" = workerd/SSR).
// We set all three knobs HERE so they actually apply to the worker graph:
//   - optimizeDeps.include : pre-bundle everything in one pass (no lazy-discovery reloads)
//   - resolve.noExternal   : bundle React + consumers instead of externalizing a 2nd copy
//   - resolve.dedupe       : collapse react/react-dom to a single instance
function optimizeServerDeps() {
  return {
    name: "optimize-server-deps",
    /** @param {string} name */
    configEnvironment(name) {
      if (name !== "client") {
        return {
          resolve: {
            noExternal: SERVER_NO_EXTERNAL,
            dedupe: ["react", "react-dom"],
          },
          optimizeDeps: { include: SERVER_OPTIMIZE_DEPS },
        };
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
      DEMO_VIDEO_ID: envField.string({ context: "client", access: "public", default: "MWDi3Zmlu1I" }),
    },
  },
});
