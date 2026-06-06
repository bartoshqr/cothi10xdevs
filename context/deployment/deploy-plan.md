# Deploy plan — audit trail (cothi10xdevs)

Companion to `deployment-plan.md`. That file is the planning document; this is the **record of what actually happened**, written after first deploy.

## Live deployment

- **Worker name:** `cothi10xdevs`
- **Production URL:** https://cothi10xdevs.rtek-rko.workers.dev/
- **Cloudflare account:** rtek.rko@gmail.com
- **First deployed:** 2026-05-22

## Production version history

In deploy order, oldest first. Use these IDs as rollback targets.

| Version ID | Created | Notes |
|---|---|---|
| `471baae8-f268-4c27-bf3e-eab0eacfcc4a` | 2026-05-22 08:04 | Bootstrap — created the Worker entity (no secrets, no logs config) |
| `3e138255-6f2a-4c9d-a65a-d67d4e3d4062` | 2026-05-22 08:05 | First real deploy from `dist/`; SESSION KV auto-provisioned |
| `b44d914a-16ea-4fef-a2e8-35ed73b816b5` | 2026-05-22 08:09 | Secrets bound: `SUPABASE_URL`, `SUPABASE_KEY` |
| `0844499d-b3da-47a9-8708-06710a88dbf3` | 2026-05-22 08:39 | `observability.logs.enabled: true` added |
| `0d306d49-a538-404c-a25d-043b7115017f` | 2026-05-22 10:42 | Roll-forward after Phase 9 rollback rehearsal |
| (subsequent versions) | (push to `master`) | Workers Builds auto-deploys; see dashboard for IDs |

## Provisioned Cloudflare resources

- **Worker:** `cothi10xdevs`
- **KV namespace (auto-provisioned, unused):** `cothi10xdevs-session` (ID `10df2fb7661446c182ab5847aad7bb13`) — bound as `env.SESSION`; no reads/writes since the app uses Supabase Auth cookies, not Astro sessions
- **Assets binding:** `env.ASSETS` → `dist/client/` (static files)
- **Workers Logs:** enabled via `observability.logs.enabled: true` in `wrangler.jsonc`
- **Workers Builds (GitHub integration):** connected to the repo; auto-deploys on push to `master`
- **Secrets (Workers namespace, encrypted):** `SUPABASE_URL`, `SUPABASE_KEY`

## Canonical commands

All deploy / observe / rollback commands use `-c dist/server/wrangler.json` (the adapter-generated config that points at the right entry & assets). Top-level `wrangler.jsonc` is minimal scaffolding.

```bash
# Build + deploy
npm run build
npx wrangler deploy -c dist/server/wrangler.json

# Live log stream
npx wrangler tail -c dist/server/wrangler.json

# List versions
npx wrangler deployments list -c dist/server/wrangler.json

# Rollback to a specific version (interactive — prompts y/N + message)
npx wrangler rollback <version-id> -c dist/server/wrangler.json

# Add or rotate a secret (interactive — prompts for value)
npx wrangler secret put <NAME> -c dist/server/wrangler.json

# List secret names (values stay encrypted)
npx wrangler secret list -c dist/server/wrangler.json
```

## Deploy convention

- **Push to `master`** = production deploy via Workers Builds (the path of record)
- **Local `wrangler deploy`** = hotfix / ad-hoc only; goes straight to production with no Git audit trail
- **Local `wrangler deploy` to a custom branch name** doesn't exist on Workers (no preview-branch concept; every deploy is live)

## Risk register — resolutions

Mapping each row in `context/foundation/infrastructure.md`'s register to what actually happened:

| Risk | Status | How |
|---|---|---|
| Astro 6 + Supabase Auth + Cloudflare adapter build failure (GitHub #15796) | **Stale** | Issue closed 2026-03-09; fix shipped in `astro@6.3.1`. Build clean on this version. |
| Free-tier 10 ms CPU limit on React SSR + auth pages | **Carried** | No 1102 errors observed on smoke test. Monitor under real traffic; upgrade to Workers Paid ($5/mo) at first sign. |
| `wrangler deploy` vs `wrangler pages deploy` command mismatch | **Hit & resolved** | First `wrangler pages deploy` failed (`ASSETS` reserved on Pages). Migrated to Workers model mid-Phase-5; now using `wrangler deploy -c dist/server/wrangler.json` consistently. |
| `astro:env` Cloudflare binding breaks on adapter version bump | **Mitigated** | `@astrojs/cloudflare` pinned to `13.5.3`. Upgrade only after reading the changelog and re-running the smoke checks against secrets. |
| Preview deploy URLs expose private app publicly | **Accepted** | User decision (Phase 6 skipped): this project doesn't need access protection. Revisit if sensitivity changes. |
| No historical log retention without Workers Logs enabled | **Mitigated** | `observability.logs.enabled: true` in `wrangler.jsonc`. Verified by tailing past requests in dashboard. |
| Cloudflare Images binding enabled by default in Astro 6 adapter | **Mitigated** | `imageService: "passthrough"` in `astro.config.mjs`. Build log no longer prints the IMAGES binding message. |
| Adapter versioning fragility in post-acquisition integration period | **Mitigated (procedural)** | Version pinned; smoke checks documented; rollback rehearsed and confirmed working. |

## Significant deviations from the original plan

1. **Pages → Workers mid-Phase-5.** Original plan deployed to Cloudflare Pages. First `wrangler pages deploy` failed because the adapter writes a Workers-style config (`dist/server/wrangler.json` with `ASSETS` binding) that Pages rejects. Switched to the Workers deployment model — cleaner long-term, aligned with where Cloudflare and the adapter both want you to be. Cost: rewrote `wrangler.jsonc` (minimal Workers config), re-uploaded secrets to the Workers namespace, dropped the empty Pages project, updated Phases 6–10 to Workers equivalents. URL changed from `*.pages.dev` to `*.workers.dev`.

2. **SESSION KV binding left enabled (not disabled).** The adapter offers no clean "disable Astro sessions" option. Decision: accept the binding, let Cloudflare auto-provision the namespace, never call any session API. Cost: one unused KV namespace ($0/month).

3. **Phase 6 (preview lockdown) skipped.** App is not sensitive enough to warrant Cloudflare Access. Public `workers.dev` URL is the production endpoint.

4. **First `wrangler secret put` 502'd on Worker bootstrap.** Cloudflare API failed to create the Worker via the secret-put path. Workaround: deploy first → secrets succeed → redeploy to bind. Documented in Phase 5.

## What to know for the next deploy

- Pulled changes? → `npm install && npm run build && npx wrangler deploy -c dist/server/wrangler.json` (or just push to `master` and Workers Builds handles it)
- Adapter or wrangler version bump? → run the Phase 5 smoke checks before considering the deploy clean
- Lost a deploy? → `npx wrangler rollback <last-good-version-id> -c dist/server/wrangler.json` (see version-history table above for known-good IDs)
- Logs from past requests → dashboard → Workers & Pages → `cothi10xdevs` → Logs
- Live log stream → `npx wrangler tail -c dist/server/wrangler.json`
