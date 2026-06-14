# React SSR crashes under Astro 6 + Cloudflare workerd dev

**Status:** Resolved. Fix lives in `astro.config.mjs` (`SERVER_OPTIMIZE_DEPS`, `SERVER_NO_EXTERNAL`,
the `optimizeServerDeps()` plugin, and `vite.resolve`).
**Date:** 2026-06-14.
**Applies to:** Astro 6.3.1, `@astrojs/cloudflare` 13.5.3, `@astrojs/react` 5.0.4, React 19.2.6,
Vite 7.3.3, `output: "server"` on Cloudflare Workers.

> **One-line takeaway:** when you add a new React/island library, add it to **both**
> `SERVER_OPTIMIZE_DEPS` **and** `SERVER_NO_EXTERNAL` in `astro.config.mjs`, or these crashes
> come back for that one dependency.

---

## The symptom

`npm run dev` would crash during server-side rendering (SSR) with a rotating cast of errors,
all printed to the **terminal** (not the browser — these are server-side):

- `TypeError: jsxDEV is not a function`
- `Invalid hook call. Hooks can only be called inside of the body of a function component`
- `TypeError: Cannot read properties of null (reading 'useContext')` (in `lucide-react`)
- `TypeError: Cannot read properties of null (reading 'useState')` (in our own island components)

The error would name a different file/library each run (`SignInForm.tsx`, `lucide-react`,
`InviteChallenger.tsx`, `CreateDebateForm.tsx`…). Clearing `node_modules/.vite` "fixed" it only
until the next re-optimization. It never happened with the Node adapter — only on Cloudflare.

## Why it happens (the real root cause)

Astro 6 moved the **dev server SSR into Cloudflare's `workerd` runtime** via
`@cloudflare/vite-plugin`, so local dev now mirrors production. That surfaced two latent problems,
both variations of **"more than one copy of React in the SSR bundle"** — React's hook dispatcher
is a module-level singleton, so if `react-dom/server` sets it on one copy of React and a component
reads hooks from a _different_ copy, that read is `null`.

There were **two distinct failure modes**, which is why it took several rounds:

### Failure mode 1 — lazy dependency discovery (at startup / first request)

`workerd` is its own Vite "environment" with its own dependency optimizer (the `deps_ssr/` folder).
If not told otherwise, Vite discovers SSR deps **lazily**, one per request. Each discovery re-runs
optimization and **reloads the worker mid-render**, leaving `react` and `react-dom/server` in
separate optimize passes → split React copies → null dispatcher. In our project the last lazy
straggler was `astro/env/runtime` (pulled in by our `astro:env` Supabase secrets).

### Failure mode 2 — externalized + bundled duplication (after an HMR `program reload`)

Even after pre-bundling everything, the worker environment was loading React from **two** places at
once: Vite's pre-bundled `deps_ssr/` **and** a raw externalized copy from `node_modules/`. At
startup both copies' dispatchers happened to be live (so the page rendered), but after any worker
**`program reload`** — triggered by HMR, e.g. Tailwind regenerating `src/styles/global.css` — only
the bundled copy's `react-dom/server` re-ran and set its dispatcher. A still-externalized
`lucide-react` read the _other_ copy's null dispatcher and crashed. This is the one that bit us
"randomly" while just navigating the app.

> Note: `lucide-react` was the usual victim because it calls `createContext()` at module scope
> (see [lucide#4200]), which is maximally sensitive to React-copy duplication — but the bug is the
> duplication, not lucide.

## The critical insight that unlocked the fix

Under `@cloudflare/vite-plugin`, **the worker SSR environment is a separate Vite environment, and
top-level `vite.optimizeDeps` / `vite.ssr.*` / `vite.resolve` DO NOT reach it.** You must configure
that environment explicitly through the **`configEnvironment` hook** of a small Vite plugin (matching
every environment whose name is not `"client"`). This is why several "correct-looking" fixes did
nothing — they were silently applied to the wrong environment.

---

## What was tried, in order

| #   | Commit    | Attempt                                                                                              | Result                                                             |
| --- | --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `e9eb7ce` | Top-level `vite.optimizeDeps.include` for React entry points                                         | ❌ jsxDEV came back — wrong environment                            |
| 2   | `088c37c` | Added `resolve.dedupe` + more island libs to top-level `optimizeDeps`                                | ❌ moved to `useContext`/`useState` null — still wrong environment |
| 3   | `eb04ab8` | `configEnvironment` plugin (reaches worker env) + `react-dom/server` → `react-dom/server.edge` alias | ✅ big progress, but still crashed                                 |
| 4   | `65163c9` | Added `astro/env/runtime` to the include list                                                        | ✅ killed failure mode 1 (clean at startup)                        |
| 5   | `25e5e04` | `resolve.noExternal` (+ `dedupe`) **on the worker environment**                                      | ✅ killed failure mode 2 (survives `program reload`)               |

### What did NOT work (and why)

- **Top-level `vite.optimizeDeps` / `vite.resolve.dedupe`** — never reaches the worker environment;
  fails silently. (Attempts 1–2.)
- **Clearing `node_modules/.vite`** — temporary only; the next re-optimization re-split React.
- **Gemini's first suggestions** (`resolve.conditions: ['workerd', …]`, blanket `ssr.noExternal` +
  `ssr.target: 'webworker'` in a hand-written `vite.config.ts`, or a `wrangler pages dev -- vite dev`
  script) — wrong for Astro: the `@astrojs/cloudflare` adapter manages the worker env, we have no
  `vite.config.ts`, and `npm run dev` is `astro dev`, not wrangler. The _mechanism_ Gemini described
  (dev vs prod React runtime mismatch) was roughly right; the _fixes_ were not.

### What worked (all four pieces are needed)

Configured on the **worker (`name !== "client"`) environment** via `configEnvironment`:

1. `optimizeDeps.include` = every React entry point + every island lib + `astro/env/runtime`,
   pre-bundled in **one startup pass** → no lazy discovery, no mid-render reloads.
2. `resolve.noExternal` = React + every React-consuming lib → one bundled copy, nothing externalized
   to desync after a reload.
3. `resolve.dedupe = ["react", "react-dom"]` → collapse to a single instance.

Plus, in top-level `vite.resolve` (for the client graph + build): 4. `alias: { "react-dom/server": "react-dom/server.edge" }` → the Web-Streams ("edge") build that
`workerd` requires in dev as well as prod; the Node-streams build is what throws
`jsxDEV is not a function`.

## How it was verified

- Ran the dev server, `curl`ed `/auth/signin` (the page that crashed every time): clean 200.
- Forced **5 `program reload`s** by repeatedly editing `src/styles/global.css`, hitting
  `/auth/signin` and `/` after each: all 200, zero `useContext`/invalid-hook errors in the log.
- `npm run dev` boots with no `new dependencies optimized … reloading` churn.

## Maintenance rule

`SERVER_OPTIMIZE_DEPS` and `SERVER_NO_EXTERNAL` are **manual allow-lists**. Anything new that the SSR
pass meets on first render — a new React island library, an icon pack, or an Astro internal/virtual
module discovered lazily — can re-trigger the cascade. **Add new React/island deps to both lists.**
Watch the dev terminal for `✨ new dependencies optimized: <x>` followed by `reloading`: whatever
`<x>` is, add it to the lists.

## References

- [cloudflare/workers-sdk#11825 — @cloudflare/vite-plugin: SSR causes "Invalid hook call" due to module duplication][cf-11825] — the decisive root-cause + `noExternal` workaround.
- [withastro/astro#16529 — @astrojs/cloudflare + React island = Invalid hook call][astro-16529]
- [withastro/astro#16029 — Astro 6 + Cloudflare adapter v13 dependency-scan/optimizer issues][astro-16029]
- [EdgeKits — How I Migrated From Astro 5 to 6 With All My React Islands][edgekits] — the `configEnvironment` + `server.edge` recipe on our exact stack.
- [lucide-icons/lucide#4200 — module-level createContext() breaks under SSR][lucide-4200]
- [Cloudflare Workers docs — Vite environments][cf-vite-env]
- [React — Invalid hook call warning][react-invalid-hook]

[cf-11825]: https://github.com/cloudflare/workers-sdk/issues/11825
[astro-16529]: https://github.com/withastro/astro/issues/16529
[astro-16029]: https://github.com/withastro/astro/issues/16029
[edgekits]: https://edgekits.dev/en/blog/astro-5-to-6-migration-react-islands-cloudflare/
[lucide-4200]: https://github.com/lucide-icons/lucide/issues/4200
[cf-vite-env]: https://developers.cloudflare.com/workers/vite-plugin/reference/vite-environments/
[react-invalid-hook]: https://react.dev/link/invalid-hook-call
