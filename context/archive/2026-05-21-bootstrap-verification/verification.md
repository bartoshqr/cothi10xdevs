---
bootstrapped_at: 2026-05-21T08:59:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: worldview-map
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: worldview-map
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

### Why this stack

A solo advocate-tooling MVP on an 8-week after-hours budget, targeting a small private user base — needs a battle-tested, agent-friendly starter that ships auth, a typed Postgres data layer, and edge deploy out of the box. 10x Astro Starter (Astro 6 + React 19 + TypeScript + Tailwind 4 + Supabase + Cloudflare Pages) is the recommended default for `(web, js)` and clears all four agent-friendly gates: typed end-to-end (TypeScript + Zod), convention-based (Astro routing + Supabase schemas), popular in JS training data, and well-documented. Supabase covers email + OAuth auth (FR-001/002) and the graph-shaped Statement/relation/mark data model on Postgres; the deterministic <10s summary (FR-020, NFR) fits comfortably within edge-runtime budgets on a small graph. PRD non-goals (no realtime, no mobile, no external notifications, no AI in MVP) align with the starter's island/SSR posture. CI runs on GitHub Actions with auto-deploy on merge — the starter's default shape.

---

## Pre-scaffold verification

| Signal      | Value                                                    | Severity | Notes                                            |
| ----------- | -------------------------------------------------------- | -------- | ------------------------------------------------ |
| npm package | not run                                                  | —        | cmd_template starts with `git clone`; npm check skipped |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url; 4 days before scaffold run   |

---

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (clone starter repo without keeping its git history)
**Exit code**: 0
**Cloned .git deleted**: yes — upstream history does not leak into user's repo
**Files moved**: 19 (astro.config.mjs, components.json, .env.example, eslint.config.js, .github/, .husky/, .nvmrc, .prettierrc.json, .vscode/, node_modules/, package.json, package-lock.json, public/, README.md, src/, supabase/, tsconfig.json, wrangler.jsonc + node_modules deps)
**Conflicts (.scaffold siblings)**: CLAUDE.md → CLAUDE.md.scaffold
**.gitignore handling**: append-merged — 0 cwd lines deduplicated; scaffold lines appended under `# from 10x-astro-starter` separator
**.bootstrap-scaffold cleanup**: deleted

---

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/3/0 direct of total 0/1/10/0

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (transitive via Svelte) — "Svelte devalue: DoS via sparse array deserialization" · GHSA-77vg-94rm-hx3p · CVSS 7.5 · CWE-770 · range: 5.6.3–5.8.0 · fix available (update upstream)

#### MODERATE findings

Direct (3):
- **@astrojs/check** — via @astrojs/language-server (volar-service-yaml chain) · range: >=0.9.3 · fix: downgrade to 0.9.2 (semver major)
- **@astrojs/cloudflare** — via @cloudflare/vite-plugin + wrangler (ws chain) · range: >=12.2.4 · fix: 12.6.13 (semver major)
- **wrangler** — via miniflare (ws chain) · range: >=3.108.0 · fix: pin to 3.107.3 (semver major)

Transitive (7):
- **@astrojs/language-server** — via volar-service-yaml
- **@cloudflare/vite-plugin** — via miniflare + wrangler + ws
- **miniflare** — via ws
- **volar-service-yaml** — via yaml-language-server
- **ws** (×2: ws root + @supabase/realtime-js/node_modules/ws) — "ws: Uninitialized memory disclosure" · GHSA-58qx-3vcg-4xpx · CVSS 4.4 · range: 8.0.0–8.20.0
- **yaml** — "yaml: Stack Overflow via deeply nested YAML collections" · GHSA-48c2-rrv3-qjmp · CVSS 4.3 · range: 2.0.0–2.8.2
- **yaml-language-server** — via yaml

#### LOW / INFO findings

None.

---

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | github-actions      |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | false               |
| has_ai                  | false               |
| has_background_jobs     | false               |

All hints are preserved here for the future M1L4 skill (agent context / CLAUDE.md generation) which will act on deployment_target, ci_provider, ci_default_flow, and the has_* feature flags. bootstrapper_confidence: first-class means the starter's CLI is registered and expected to work — no manual touch-up anticipated.

---

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git add -A && git commit -m "chore: scaffold 10x-astro-starter"` to checkpoint the scaffold in your repo history.
- Review `CLAUDE.md.scaffold` — the starter ships its own CLAUDE.md; diff it against your existing file and merge anything useful.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. The HIGH (`devalue`) and the `ws` MODERATE are both toolchain/dev-dependencies; they carry no production surface on Cloudflare Pages.
- Copy `.env.example` to `.env` and fill in your Supabase project credentials before running `npm run dev`.
