---
project: worldview-map
researched_at: 2026-05-21
recommended_platform: Cloudflare Workers + Pages
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd)
  database: Supabase (external)
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

The tech stack was chosen with `deployment_target: cloudflare-pages` and the codebase is already wired for the Cloudflare Workers runtime — `wrangler.jsonc` is present, `@astrojs/cloudflare` is the adapter, and `astro:env` secrets are declared as Cloudflare bindings. Every alternative platform requires replacing the adapter, removing `wrangler.jsonc`, and re-wiring secrets — a non-trivial migration with no compensating benefit for this MVP's scope (stateless, single-region, low-traffic). Cloudflare scores 10/10 across all five agent-friendly criteria, offers a free tier that covers the expected request volume, and ships the deepest agent integration of any platform researched (GA MCP server, `llms.txt`, Claude Code integration guide). The three anti-bias lenses surfaced real risks (adapter versioning fragility, free-tier CPU ceiling, public preview URLs) — all documented in the risk register below.

## Platform Comparison

### Scoring Matrix

| Platform | CLI-first | Managed | Agent docs | Deploy API | MCP | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers + Pages** | Pass | Pass | Pass | Pass | Pass | **10** |
| **Vercel** | Pass | Pass | Pass | Pass | Partial¹ | **9** |
| **Netlify** | Partial² | Pass | Pass | Pass | Pass | **9** |
| Fly.io | Partial³ | Partial | Partial | Pass | Partial⁴ | **6** |
| Railway | Partial³ | Partial | Pass | Partial³ | Partial⁵ | **6** |
| Render | Partial³ | Partial | Partial | Partial³ | Pass | **6** |

¹ Vercel MCP: **beta** (launched August 2025, still beta as of 2026-05-21)  
² Netlify: no `netlify rollback` CLI — rollback requires dashboard or API  
³ No dedicated rollback CLI; container-based, not edge/serverless  
⁴ Fly.io `fly mcp server`: **experimental** (2026-05-21)  
⁵ Railway MCP: active development, explicitly "not GA" (2026-05-21)

**Hard filters applied**: none — the app is stateless (Q1: no persistent connections), so serverless platforms were not filtered out. Container-based platforms (Fly.io, Railway, Render) were not dropped but incur a mandatory `@astrojs/node` adapter migration cost, which depresses their effective score relative to the native-fit Cloudflare path.

**Soft weights applied**: Q4 (single region fine) removed the edge-native bonus that would have further widened Cloudflare's lead. Q3 (familiarity with Railway/Render/Fly.io) added a +1 tie-breaker to those platforms — insufficient to close the 4-point gap to Cloudflare.

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

The native fit is the decisive factor. Astro 6 was co-developed with Cloudflare (Cloudflare acquired Astro in early 2026), and `@astrojs/cloudflare` adapter targets `workerd` directly — local dev and production run the same runtime. Wrangler CLI covers all operational verbs: `wrangler deploy`, `wrangler rollback <deployment-id>`, `wrangler tail`. Docs are served as `llms.txt` and `llms-full.txt` per product, plus per-page `Accept: text/markdown` support. A first-party MCP server (`mcp-server-cloudflare`) is GA with a dedicated Claude Code integration guide. Free tier covers 100K requests/day — well above the expected MVP load. The only costs are the adapter versioning fragility and the active Astro 6 + Supabase Auth build issue (GitHub #15796), both documented in the risk register.

#### 2. Vercel

Vercel is the strongest alternative if the Cloudflare path is blocked. The `@astrojs/vercel` adapter is GA, `llms.txt` coverage is excellent, and the CLI (`vercel deploy`, `vercel rollback`, `vercel logs`) is fully scriptable. The MCP server is **beta** as of 2026-05-21 — functional but with a changing API surface. The main gaps: full SSR pages run as Serverless Functions (Node.js), not at the edge; switching requires replacing `@astrojs/cloudflare` with `@astrojs/vercel` and reworking `astro:env` bindings. An active Astro 6 build error on Vercel previews (issue #16258) is worth monitoring. Hobby tier is free for non-commercial use.

#### 3. Netlify

Netlify scores identically to Vercel (9/10) with a GA MCP server (launched June 2025) and a complete CLI toolset. Its disqualifying weakness for active MVP development is the credit-based pricing model introduced September 2025: 300 credits/month on the free tier, where each production deploy costs 20 credits (~15 deploys/month before upgrade). Pro ($19/month) is the practical entry point for any project with real commit frequency. Rollback also lacks a CLI command — dashboard or API only. Requires the same `@astrojs/cloudflare` → `@astrojs/netlify` adapter swap as Vercel.

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. **Active Supabase Auth + Astro 6 + Cloudflare build failure (GitHub #15796)**: An open issue documents build failures when combining Astro 6, the Cloudflare adapter, and Supabase Auth. This project uses all three. Status unresolved as of 2026-05-21 — verify before first deploy.

2. **Free-tier 10 ms CPU limit is tighter than it appears**: React 19 SSR with Supabase auth initialization can consume 8–15 ms of CPU per request on content-heavy pages. The free tier's 10 ms ceiling causes intermittent 1102 errors on pages that exceed it — the error appears as a user-visible timeout, not a clear platform message. The paid tier ($5/month, 30 ms CPU) resolves it but the jump is non-gradual.

3. **`wrangler deploy` vs `wrangler pages deploy` is a sharp footgun**: Cloudflare now recommends Workers for new projects, but the starter targets Pages. The two deploy commands are not interchangeable. The README documents `npx wrangler deploy` (the Workers command); running it against a Pages project deploys to the wrong target silently.

4. **`astro:env` Cloudflare binding pattern has broken before**: The adapter removed `Astro.locals.runtime` in v6 without a clear migration guide. The pattern may break again on future adapter bumps — the adapter is actively evolving in a post-acquisition integration period.

5. **No historical log retention by default**: `wrangler tail` is a live stream only. Past requests are not queryable unless Workers Logs is explicitly enabled in the dashboard. An agent debugging a past error has no log history to retrieve from the CLI.

### Pre-Mortem — How This Could Fail

The team shipped auth on day one. Local `workerd` development felt like a genuine superpower — exact runtime parity. They hit their first wall three months in, during a routine Astro patch upgrade. The `@astrojs/cloudflare` adapter version bumped alongside it, and the way it resolved `astro:env` secrets changed without a clear migration note. The Supabase URL and key stopped being injected; the build succeeded but requests returned 500s in production only. By the time they traced it to the adapter binding change, two days had passed and the auth system was silently broken for all users.

Meanwhile, intermittent 1102 errors had been appearing on the most visited pages — a profile summary page that ran a Supabase query plus React hydration in a single SSR pass. They'd been dismissing these as Supabase network timeouts. The real cause was the free tier's 10 ms CPU ceiling being crossed on pages that took 12–14 ms to render. Moving to the paid tier ($5/month) fixed it immediately — but diagnosing the wrong layer had cost two weeks of confusion.

The underlying assumptions that failed: that the free tier's CPU budget was comfortable for React SSR with auth, and that Astro + Cloudflare adapter versioning would be stable enough to upgrade without scrutiny. Both are wrong for an actively evolving adapter in a post-acquisition integration period.

### Unknown Unknowns

- **Cloudflare acquired Astro in early 2026** — `cloudflare-binding` imageService is now the default in the Astro 6 Cloudflare adapter, silently coupling the app to Cloudflare Images (a paid product). If the binding is not configured, builds pass but image processing fails in production.

- **Preview deploy URLs are public by default** — Cloudflare Pages preview deploys are publicly accessible without authentication unless Cloudflare Access is layered on. For a private-user-base app, every branch push creates a public URL exposing the app to anyone with the link.

- **Workers vs Pages is not a cosmetic distinction** — the starter targets Pages, but Cloudflare now routes all new feature development through Workers. Pages Functions are Workers under the hood, but the deployment path, secret management, and CI integration differ. An agent following Workers documentation against a Pages deployment will use wrong commands.

- **`wrangler tail` shows logs for the active deployment only** — during a rollback, if the agent is tailing logs while the prior deployment is live, it reads logs from the rolled-back version with no per-version isolation. Debugging a rollback scenario requires discipline to confirm which deployment is actually active.

## Operational Story

- **Preview deploys**: Cloudflare Pages creates a preview URL on every branch push (`<branch>.<project>.pages.dev`). Preview URLs are publicly accessible by default — add Cloudflare Access (`wrangler pages project` + Access policy) to restrict them for a private-user-base app.

- **Secrets**: Production secrets live in Cloudflare Workers Secrets (`npx wrangler secret put SUPABASE_URL`, `npx wrangler secret put SUPABASE_KEY`). Locally, secrets live in `.dev.vars` (gitignored). CI secrets are stored as GitHub Actions repository secrets, referenced in the workflow as `${{ secrets.SUPABASE_URL }}`. Only the Cloudflare account owner can list/rotate secrets; agents can call `wrangler secret put` with a scoped API token.

- **Rollback**: `npx wrangler rollback` reverts to the previous deployment; `npx wrangler rollback <deployment-id>` targets a specific version. Typical time-to-revert is under 30 seconds globally. Caveat: rollback reverts code only — Supabase DB migrations do not roll back automatically; coordinate schema changes with deploys.

- **Approval**: The following actions require a human: publishing to production from a branch preview (if Access is enabled), rotating the `SUPABASE_URL`/`SUPABASE_KEY` secrets via the dashboard, deleting a Pages project, and billing tier changes. An agent may perform: `wrangler deploy`, `wrangler rollback`, `wrangler tail`, `wrangler secret put` (with a scoped API token), and all read-only MCP operations.

- **Logs**: Live stream via `wrangler tail` (flags: `--status error`, `--search <term>`, `--format json`, `--sampling-rate`). Historical logs require Workers Logs to be enabled in the Cloudflare dashboard first (`Settings → Observability → Workers Logs`). MCP alternative: `mcp-server-cloudflare` exposes structured log queries when Workers Logs is enabled.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Astro 6 + Supabase Auth + Cloudflare adapter build failure (GitHub #15796) | Research finding | High (unresolved issue) | High (blocks first deploy) | Check issue status before deploying; pin adapter version that is confirmed working; track issue resolution |
| Free-tier 10 ms CPU limit exceeded on React SSR + auth pages | Devil's advocate | Medium | Medium (user-visible 1102 errors) | Upgrade to paid tier ($5/month) at first sign of 1102 errors; profile SSR CPU time locally using `wrangler dev --remote` |
| `wrangler deploy` vs `wrangler pages deploy` command mismatch in README | Devil's advocate | Medium | Medium (deploys to wrong target) | Verify `wrangler.jsonc` type field (`pages` vs `workers`) before first deploy; update README to use the correct command |
| `astro:env` Cloudflare binding breaks on adapter version bump | Devil's advocate | Medium | High (silent auth failure in production) | Pin `@astrojs/cloudflare` version in `package.json`; review adapter changelog before any upgrade; add a smoke test that verifies Supabase secrets are injected at runtime |
| Preview deploy URLs expose private app publicly | Unknown unknowns | High (default behavior) | Medium (privacy exposure for small private user base) | Configure Cloudflare Access on the Pages project before any user-facing content is deployed to preview branches |
| No historical log retention without Workers Logs enabled | Unknown unknowns | High (off by default) | Medium (blind to past errors) | Enable Workers Logs in the dashboard before first production deploy; document the `wrangler tail` vs Workers Logs distinction in the runbook |
| Cloudflare Images binding enabled by default in Astro 6 adapter | Unknown unknowns | Medium | Low (build passes, image processing fails silently) | Set `image: { service: 'passthrough' }` in `astro.config.mjs` if Cloudflare Images is not needed; verify the default `imageService` setting in the installed adapter version |
| Adapter versioning fragility in post-acquisition integration period | Pre-mortem | Medium | High (production auth breakage) | Lock `@astrojs/cloudflare` to a pinned version; only upgrade after reading the full adapter changelog and verifying Supabase compatibility |

## Getting Started

1. **Verify the open Supabase Auth issue first**: Check [github.com/withastro/astro/issues/15796](https://github.com/withastro/astro/issues/15796) before proceeding. If the issue is still open, pin `@astrojs/cloudflare` to the last known-good version.

2. **Set production secrets via Wrangler**:
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```
   These are stored in Cloudflare's encrypted secrets vault, not in `wrangler.jsonc`.

3. **Enable Workers Logs before first deploy**:
   Cloudflare dashboard → Workers & Pages → your project → Settings → Observability → Workers Logs → Enable. Without this, `wrangler tail` is the only log access and it shows live requests only.

4. **Confirm the correct deploy command** for your project type. Check `wrangler.jsonc` for the `"type"` field:
   - Pages project: `npx wrangler pages deploy ./dist`
   - Workers project: `npx wrangler deploy`
   Update the README and CI workflow accordingly.

5. **Restrict preview deploy URLs** before pushing any branch with user-facing content:
   Cloudflare dashboard → Access → Applications → Add Application → Cloudflare Pages → select your project → add an email-based policy or `rtek.rko@gmail.com` allowlist.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions wiring)
- Production-scale architecture (multi-region, HA, DR)
