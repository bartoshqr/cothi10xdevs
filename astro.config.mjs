// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Force a single physical copy of React no matter how many optimize passes run.
    // This is the canonical fix for React's "more than one copy of React in the same app"
    // invalid-hook-call error (null useState/useContext dispatcher) under workerd SSR.
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      // Pre-bundle all React entry points AND every React-consuming library in one
      // startup pass so they share a single React instance. Prevents the intermittent
      // "jsxDEV is not a function" / "Cannot read properties of null (reading 'useContext')"
      // SSR crashes under Astro 6 + Cloudflare workerd dev, caused by lazy dep discovery
      // optimizing React (and its consumers) in separate passes with duplicate React copies.
      include: [
        "react",
        "react-dom",
        "react-dom/server",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "lucide-react",
        "@radix-ui/react-slot",
        "@xyflow/react",
        "zustand",
      ],
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
