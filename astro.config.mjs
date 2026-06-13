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
    optimizeDeps: {
      // Pre-bundle all React entry points in one startup pass so react-dom/server
      // and the JSX runtimes share a single React instance. Prevents the intermittent
      // "jsxDEV is not a function" SSR crash under Astro 6 + Cloudflare workerd dev,
      // which is caused by lazy dep discovery optimizing React in separate passes.
      include: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "react/jsx-dev-runtime"],
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
