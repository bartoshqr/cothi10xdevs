---
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
---

## Why this stack

A solo advocate-tooling MVP on an 8-week after-hours budget, targeting a small
private user base — needs a battle-tested, agent-friendly starter that ships
auth, a typed Postgres data layer, and edge deploy out of the box. 10x Astro
Starter (Astro 6 + React 19 + TypeScript + Tailwind 4 + Supabase + Cloudflare
Pages) is the recommended default for `(web, js)` and clears all four
agent-friendly gates: typed end-to-end (TypeScript + Zod), convention-based
(Astro routing + Supabase schemas), popular in JS training data, and
well-documented. Supabase covers email + OAuth auth (FR-001/002) and the
graph-shaped Statement/relation/mark data model on Postgres; the deterministic
<10s summary (FR-020, NFR) fits comfortably within edge-runtime budgets on a
small graph. PRD non-goals (no realtime, no mobile, no external notifications,
no AI in MVP) align with the starter's island/SSR posture. CI runs on GitHub
Actions with auto-deploy on merge — the starter's default shape.
