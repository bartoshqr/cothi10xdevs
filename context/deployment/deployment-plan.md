# Cloudflare Pages Integration & First Deploy

## Context

The project (npm package `10x-astro-starter`, deployed as Cloudflare Pages project `cothi10xdevs`; Astro 6.3.1 + React 19 + Supabase) is already wired for Cloudflare Pages — `@astrojs/cloudflare@13.5.3` adapter is installed, `wrangler.jsonc` declares `pages_build_output_dir: ./dist`, `astro:env/server` injects `SUPABASE_URL` / `SUPABASE_KEY`, and CI builds green. What's missing is the actual deployment: no accounts, no secrets in Cloudflare, no preview URL strategy, no rollback runbook, and a few of the risks in `context/foundation/infrastructure.md` need either a fix or a deliberate "accept" decision.

This plan executes a **safe first deploy to Cloudflare Pages** while resolving each risk from the infrastructure register in order, paying special attention to two adapter-v13 behaviors discovered during research:

- The Astro 6 Cloudflare adapter v13 **auto-enables a Cloudflare Images binding (`IMAGES`)** and a **KV sessions binding (`SESSION`)** at build time. Builds succeed without the bindings configured, but image transforms and any session usage fail in production silently. We will explicitly disable both since this app uses neither (Supabase Auth stores its session in cookies, and there are no `<Image>` components in `src/pages/`).
- GitHub issue [withastro/astro#15796](https://github.com/withastro/astro/issues/15796) (flagged "High likelihood / High impact" in `infrastructure.md`) was **closed on 2026-03-09** and the fix is in `astro@6.3.1`. The risk register row is stale; the plan documents this and removes the workaround as a required step (kept only as a fallback if a regression surfaces).

Outcome: app live on a Cloudflare Pages production URL, preview deploys gated by Cloudflare Access, auto-deploy on push to `master` via Cloudflare's native Git integration (not GitHub Actions), rollback verified, and `context/deployment/deploy-plan.md` written as the audit trail.

## Phases

Each phase is a checkpoint. Tick a box only after the verification step at the end of that phase passes.

### Phase 0 — Account setup from scratch

The user has **no accounts** on Cloudflare, Supabase, or any other external service yet. Walk through each one before any CLI command. These are all free tiers; no card required for any of them at MVP scope.

**0.a — GitHub (likely already exists since this repo is on GitHub)**
- [x] Confirm you can `git push` to the existing remote with your account `bartoshqr` — if so, skip
- [x] Otherwise: https://github.com/signup → verify email → run `gh auth login` locally and pick HTTPS + browser auth

**0.b — Cloudflare account**
- [x] Sign up at https://dash.cloudflare.com/sign-up (email + password; no card)
- [x] Verify the confirmation email (click the link Cloudflare sends — required before account is usable)
- [x] Enable 2FA: dashboard → My Profile → Authentication → 2FA (recommended; protects production deploys)
- [x] Capture your **Account ID**: dashboard → right sidebar on Workers & Pages page → "Account ID" (save it; needed if you later switch to API-token auth)
- [x] Locally: `npx wrangler login` — opens a browser, click "Allow", returns to terminal with "Successfully logged in"
- [x] Verify: `npx wrangler whoami` prints your email and account name

**0.c — Supabase account & cloud project**
- [x] Sign up at https://supabase.com → "Start your project" (GitHub OAuth is fastest — reuses your GitHub login)
- [x] Create a new organization (free tier — choose "Free" plan; no card)
- [x] Create a new project inside the org:
  - Name: `cothi10xdevs` (or whatever you like)
  - Database password: generate and **save to a password manager** — this is the Postgres root password; lost = unrecoverable
  - Region: pick whatever is geographically closest to you
  - Pricing plan: Free (500 MB DB, 50 K MAU — well above MVP needs)
- [x] Wait ~2 minutes for provisioning to finish
- [x] Capture credentials: Settings → API
  - `Project URL` → this becomes `SUPABASE_URL`
  - `anon` `public` key (NOT the `service_role` key — that one bypasses Row-Level Security and must never leave the server) → this becomes `SUPABASE_KEY`
- [x] Turn off email confirmation for now: Authentication → Providers → Email → uncheck "Confirm email" → Save (matches local dev behavior; can re-enable when you wire real email)

**0.d — Save credentials safely**
- [x] Save `SUPABASE_URL`, `SUPABASE_KEY`, database password, and Cloudflare Account ID in a password manager (1Password, Bitwarden, KeePass) — **do not** paste any of these into `.env`, the repo, or this plan file
- [x] These credentials live only in (a) your password manager and (b) Cloudflare's secrets store (set in Phase 4)

**Edge case — GitHub org instead of personal account:** if you intend to push this repo to a GitHub org rather than your personal account, the Cloudflare GitHub App in Phase 10 needs org admin approval. Easier to keep it on your personal account for MVP.

**Edge case — Supabase free tier project pauses after 7 days of inactivity:** the free project goes to sleep after a week with zero traffic and takes ~30 seconds to wake on the next request. Fine for MVP; upgrade to Pro ($25/mo) only when this becomes user-visible.

**Edge case — Cloudflare requires phone verification for Workers Paid:** signup is card-free, but if Phase 5's edge case forces an upgrade to the $5/month Workers Paid plan, that step requires a card and possibly SMS verification. Not needed unless 1102 errors actually appear.

### Phase 1 — Pre-flight verification (read-only)

- [x] Confirm `@astrojs/cloudflare` is pinned (not `^`) in `package.json` — verified during exploration: `"13.5.3"` ✓
- [x] Confirm `wrangler.jsonc` has `pages_build_output_dir`, **not** a `main` entry — verified during exploration: `"pages_build_output_dir": "./dist"` ✓ (Pages project, not Workers — `wrangler pages deploy` is the correct command, not `wrangler deploy`)
- [x] Run `npm run build` locally — build succeeded; log printed BOTH `Enabling image processing with Cloudflare Images` and `Enabling sessions with Cloudflare KV` messages, confirming Phase 2 is required
- [x] Run `npx wrangler whoami` — login confirmed (token scopes returned, including `pages (write)`)

**Edge case — issue #15796 regression:** if the build fails with `require is not defined` at `node_modules/picomatch/index.js`, add the documented workaround to `astro.config.mjs`:
```js
vite: { ssr: { optimizeDeps: { include: ["astro > picomatch"] } } }
```
Then re-run the build. Do **not** add this unless the failure occurs — it's an obsolete workaround for a fixed bug.

### Phase 2 — Disable unused adapter bindings

Critical files: `astro.config.mjs`

- [x] Applied in `astro.config.mjs`: `adapter: cloudflare({ imageService: "passthrough" })` — verified against adapter types at `node_modules/@astrojs/cloudflare/dist/index.d.ts` (option `imageService: ImageServiceConfig` accepts string mode `"passthrough"`)
- [x] **Decision (user-approved):** SESSION KV binding **left enabled**. Adapter source (`dist/index.js:85`) only suppresses the binding when Astro's top-level `session.driver` is set; there is no clean `disable: true` option. Since this app never calls Astro's session API (auth is Supabase cookies), Cloudflare Pages will auto-provision an unused KV namespace on first deploy — zero cost, zero functional impact.
- [x] Re-ran `npm run build` — `IMAGES` binding message **gone**; only `SESSION` message remains (matches the accepted decision above).
- [x] Re-ran `npx astro sync` (types regenerated, no errors) and `npm run lint` (clean — only pre-existing `astro-eslint-parser` parser notices, unrelated to this edit)

### Phase 3 — Gate: Supabase cloud project ready

Cloudflare's edge cannot reach the local Docker Supabase at `http://127.0.0.1:54321`, so production needs the hosted project created in Phase 0.c.

- [x] Confirm Phase 0.c was completed: cloud Supabase project exists, `SUPABASE_URL` + `anon` key are in your password manager
- [x] Sanity check the URL: open `<SUPABASE_URL>/rest/v1/` in a browser → should return a JSON error (not a connection failure) — proves the project is live and reachable from your network
- [x] Decide: if Phase 0.c was skipped or the project is still provisioning, **stop here** until it's ready

### Phase 4 — Create Pages project & set production secrets

- [x] `npx wrangler pages project create cothi10xdevs --production-branch master` — created; project URL will be `https://cothi10xdevs.pages.dev/` once deployed
- [x] Set production secrets (interactive — agent runs the command, user pastes the value from the Phase 3 cloud project):
  - [x] `npx wrangler pages secret put SUPABASE_URL --project-name cothi10xdevs` — uploaded to production env
  - [x] `npx wrangler pages secret put SUPABASE_KEY --project-name cothi10xdevs` — uploaded to production env
- [x] Verified: `npx wrangler pages secret list --project-name cothi10xdevs` returned `SUPABASE_KEY: Value Encrypted` and `SUPABASE_URL: Value Encrypted` in the production environment

### Phase 5 — First deploy (DONE; migrated Pages → Workers mid-phase)

**Mid-phase migration:** `wrangler pages deploy` failed because the adapter writes a Workers-style `dist/server/wrangler.json` containing an `ASSETS` binding (reserved on Pages). User chose the cleaner long-term fix: switch to Workers deployment model (Cloudflare's recommended path for new projects in 2026). Changes:
- Deleted the empty Pages project `cothi10xdevs` (freed the name).
- Rewrote `wrangler.jsonc` to a minimal Workers config (`name`, `compatibility_date`, `compatibility_flags`, `observability`) — no `main`/`assets` (the adapter writes those into `dist/server/wrangler.json` at build time).
- All deploys now use `npx wrangler deploy -c dist/server/wrangler.json` (Workers), not `wrangler pages deploy` (Pages).
- Public URL is now `https://cothi10xdevs.rtek-rko.workers.dev/` (workers.dev), not `*.pages.dev`.
- Secrets moved from Pages namespace to Workers namespace.
- KV `SESSION` binding **auto-provisioned by Cloudflare** as `cothi10xdevs-session` (zero usage, zero cost per Phase 2 decision).

**⚠ Downstream impact (still to fix):** Phase 6, 7, 8, 9, 10 instructions still reference Pages dashboard paths and `wrangler pages` subcommands. These need rewriting to Workers equivalents before they're executed.

- [x] `npm run build` — clean build, ~10s
- [x] `npx wrangler deploy -c dist/server/wrangler.json` — first deploy created the Worker, auto-provisioned `cothi10xdevs-session` KV namespace; live at `https://cothi10xdevs.rtek-rko.workers.dev/`
- [x] Verified homepage loads on `https://cothi10xdevs.rtek-rko.workers.dev/` ✓
- [x] Verified `/dashboard` (unauthenticated) → 302 redirect to `/auth/signin` ✓ (middleware + secrets wired correctly)
- [x] Verified sign-up at `/auth/signup` lands on `/dashboard` after submit ✓ (Supabase Auth wired end-to-end)
- [x] Secrets uploaded as Workers secrets: `npx wrangler secret put SUPABASE_URL -c dist/server/wrangler.json` and `SUPABASE_KEY` (first attempt 502'd on Worker bootstrap; reliable order is **deploy first → upload secrets → redeploy**)

**Side warnings logged on first deploy:** `workers_dev` and `preview_urls` default to enabled when not declared. To lock down preview URLs in Phase 6, we'll set `preview_urls: false` (or restrict via Cloudflare Access).

**Edge case (now resolved) — `astro:env` secrets undefined at runtime:** the redeploy after `secret put` is what binds secrets into the running Worker. Skipping that redeploy leaves the previous version live with no secrets — symptoms would be 500s on auth pages even though `secret list` shows them present.

**Edge case (carried forward) — 1102 CPU exceeded:** not yet observed on smoke test. Watch for it once real traffic hits.

### Phase 6 — Lock down the public `workers.dev` preview URL — **SKIPPED**

**User decision:** this project doesn't need access protection; the public `workers.dev` URL stays open. No `workers_dev: false` or Cloudflare Access required. Revisit if the app handles sensitive data later.

---

### Phase 6 (original instructions, kept for reference)

Workers expose every deploy at `<worker>.<account>.workers.dev` by default (no Pages-style per-branch preview URLs — every deploy goes live at the same URL). Two complementary controls:

**6.a — Disable the `workers.dev` subdomain entirely (recommended for non-public apps)**
- [ ] Add to `wrangler.jsonc`: `"workers_dev": false` and `"preview_urls": false`
- [ ] Add a custom routing pattern (custom domain or `routes`/`zone` entry in `wrangler.jsonc`) so the Worker is still reachable
- [ ] Redeploy: `npx wrangler deploy -c dist/server/wrangler.json`
- [ ] Verify: `curl -I https://cothi10xdevs.rtek-rko.workers.dev/` returns 404 or "workers.dev disabled"

**Trade-off:** if you don't have a custom domain yet, this leaves the Worker reachable only via `wrangler tail` and the dashboard — fine for an MVP behind a domain you control, not fine if you want a quick shareable URL.

**6.b — OR keep `workers.dev` but gate it with Cloudflare Access (easier, no custom domain needed)**
- [ ] Cloudflare dashboard → Zero Trust → Access → Applications → Add Application → Self-hosted
- [ ] Application domain: `cothi10xdevs.rtek-rko.workers.dev` (or subpath like `/dashboard`)
- [ ] Policy: allow email `rtek.rko@gmail.com` (or a wider email/domain rule)
- [ ] Re-open the workers.dev URL in incognito → must show the Access login screen first

**Edge case — Access free tier limit:** Cloudflare Access free tier covers up to 50 users. Above that, costs apply.

**Edge case — Worker route precedence:** if you set both `workers_dev: false` AND no custom route, the Worker is undeployable in practice. Always pair `workers_dev: false` with a `routes` entry.

### Phase 7 — Enable Workers Logs (historical retention) — DONE

- [x] Added `"logs": { "enabled": true }` under `observability` in `wrangler.jsonc`; chose config-flag path over dashboard click so the setting survives version control
- [x] Rebuilt and redeployed: Version ID `0844499d-b3da-47a9-8708-06710a88dbf3` (replaces the Phase 5 first-deploy version `3e138255-...`)
- [x] Verified in dashboard Logs tab — recent GET to `/` appeared with `info` level, plus earlier requests still retained

### Phase 8 — "Production" semantics on Workers (no separate promotion step needed)

Unlike Pages (which has a production-branch concept), every `wrangler deploy` on Workers **immediately serves traffic on the live URL**. The first deploy from Phase 5 is already production. Two paths from here:

**8.a — Accept "every deploy is live" (chosen)**
- [x] Phase 5's deploy was already production (Workers has no preview-vs-production split)
- [x] Known-good production versions accumulated through the rehearsal: `b44d914a-...` (first secrets-bound) → `0844499d-...` (logs enabled) → `0d306d49-...` (current after roll-forward)

**8.b — Gradual rollouts via `wrangler versions` — REJECTED**

User decision: not worth the operational overhead for MVP traffic levels. Adopt later when traffic justifies it.

**Edge case — custom domain:** for a domain like `app.yourbrand.com`, add a `routes` entry to `wrangler.jsonc` pointing at the zone, then redeploy. DNS must already exist. Out of scope for first deploy.

### Phase 9 — Rollback rehearsal (Workers) — DONE

- [x] `npx wrangler deployments list -c dist/server/wrangler.json` — printed full version history (4 versions at rehearsal time)
- [x] Rolled back from `0844499d-...` → `b44d914a-...` (the immediately previous version, with secrets bound but pre-logs config) — chose a known-good target with secrets so functionality wasn't at risk
- [x] Verified live URL still served homepage + `/dashboard` 302 → `/auth/signin` after rollback
- [x] Rolled forward with `npx wrangler deploy -c dist/server/wrangler.json` → new live Version ID `0d306d49-a538-404c-a25d-043b7115017f` (identical code to `0844499d`, fresh upload timestamp)

**Confirmed:** rollback takes ~3 seconds and snaps traffic instantly; roll-forward via redeploy ~20 seconds total. Rollback messages are persisted in version history (used `"rollback rehearsal per Phase 9"` for the test).

**Caveat (carried from infrastructure.md):** rollback reverts code only. Supabase schema changes don't roll back. Not relevant here (no migrations).

### Phase 10 — Connect GitHub repo to Cloudflare Workers Builds (no GitHub Actions)

User wants auto-deploy on push to `master` handled by Cloudflare's native Git integration. The Workers equivalent of Pages' Git integration is **Workers Builds** (launched 2025).

**Important compatibility note:** Workers Builds runs in Cloudflare's build environment — separate from your machine and from GitHub Actions. Env vars for the build live in the dashboard, not in GitHub repo secrets.

- [x] Connected GitHub repo via Cloudflare dashboard (Workers & Pages → `cothi10xdevs` → Settings → Build)
- [x] Build configuration set: branch `master`, build `npm run build`, deploy `npx wrangler deploy -c dist/server/wrangler.json`, Node 22.14.0
- [x] Build-time env vars added in dashboard
- [x] No-op commit pushed to `master` → Workers Builds auto-built and auto-deployed; new Version ID visible in dashboard

**Edge case — duplicate deploy paths:** once Workers Builds is active, running `wrangler deploy` locally still works and goes straight to production. Establish a convention: `master` pushes deploy via Workers Builds; local `wrangler deploy` is for hotfix or ad-hoc only. Document the chosen convention in Phase 11.

**Edge case — Workers Builds beta features:** some Workers Builds features (e.g. preview deployments on PRs) are still rolling out. Verify in dashboard whether your account has PR-preview support; if not, only `master` pushes will trigger builds.

**Edge case — Cloudflare GitHub app permission scope:** grant access to the single repo only, not "all repos." Org repos may need admin approval.

**Edge case — first Workers Builds run may fail to find `dist/server/wrangler.json`:** the deploy command depends on the build command having run first and `astro build` having emitted the generated config. If the build step is somehow skipped or partial, the deploy step's `-c` flag points at a missing file. Verify in build logs that "Server built in X.XXs" appears before the deploy step runs.

### Phase 11 — Write the audit trail

Critical files: `context/deployment/deploy-plan.md` (new)

- [x] Wrote `context/deployment/deploy-plan.md` — live URL, all 5 production Version IDs, KV namespace ID, canonical `-c dist/server/wrangler.json` commands, deploy convention, full risk-register row-by-row resolution, four significant deviations (most notably Pages → Workers migration), next-deploy cheat-sheet
- [x] Stale risk noted: issue #15796 closed 2026-03-09 (fix in astro@6.3.1); marked stale in the deploy-plan.md risk register so the next `/10x-infra-research` run can drop the row

## Critical files (summary)

- `astro.config.mjs` — Phase 2 (`imageService: "passthrough"` applied)
- `wrangler.jsonc` — rewritten in Phase 5 to Workers mode (minimal: `name`, `compatibility_date`, `compatibility_flags`, `observability`). Phase 6 may add `workers_dev: false` + `routes`/`preview_urls: false`.
- `dist/server/wrangler.json` — adapter-generated at every build; passed to wrangler via `-c` for deploy/secret/tail/rollback commands. Not committed.
- `context/deployment/deploy-plan.md` — Phase 11 (new file, audit trail)
- `package.json` — read-only; `@astrojs/cloudflare` stays pinned at `13.5.3`
- `.github/workflows/ci.yml` — **not modified** (user chose Cloudflare native Git integration over GitHub Actions deploy). Existing CI continues running lint+build as a pre-merge gate.

No edits to `src/middleware.ts`, `src/lib/supabase.ts`, or any route — auth flow is correct as-is.

## Verification (end-to-end, after Phase 11)

1. `curl -I https://cothi10xdevs.rtek-rko.workers.dev/dashboard` → expect `302` to `/auth/signin`
2. If Phase 6.b was chosen: `curl -I https://cothi10xdevs.rtek-rko.workers.dev/` → expect Cloudflare Access challenge. If 6.a: workers.dev returns 404 and the custom domain serves the app.
3. Cloudflare dashboard → Workers & Pages → `cothi10xdevs` → Deployments → most recent deployment shows source = "GitHub" with the commit SHA from the latest push to `master` (proves Phase 10 Workers Builds is the path of record)
4. `npx wrangler tail -c dist/server/wrangler.json` while signing up on production → see request logs stream
5. Dashboard → `cothi10xdevs` → Logs → query for a request from 10 minutes ago (proves Phase 7 retention works)
6. Push a trivial commit (e.g. README edit) to `master` → within ~2 minutes, Workers Builds auto-deploys and the production URL serves the new build with no local `wrangler` invocation

## Out of scope (deferred)

- Custom domain wiring (DNS records)
- D1 / R2 / KV / Durable Objects bindings — none required by current code
- Workers Paid upgrade — only triggered by 1102 CPU errors under real traffic
- GitHub Actions deploy job — explicitly rejected by user; Cloudflare Workers Builds (Phase 10) replaces it
- Pages deployment model — abandoned mid-Phase-5 in favor of Workers (see Phase 5 migration note)
- Gradual rollouts via `wrangler versions` (Phase 8.b) — every deploy goes live immediately for MVP
- Multi-region / DR / staging environment
- Supabase schema migrations workflow (project has no schema beyond `auth.users`)
