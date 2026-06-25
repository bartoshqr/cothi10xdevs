#!/usr/bin/env bash
# Seeds the linked prod Supabase project with one published showcase debate:
# climatologist vs. skeptic, the full end-state graph from
# tests/e2e/critical-path.spec.ts, marked public so it appears on /showcase.
# Idempotent (fixed UUIDs, on conflict do nothing) — safe to re-run.
set -euo pipefail

SQL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/seed_showcase_debate.sql"
CONFIRM_PHRASE="SEED SHOWCASE"
DEBATE_ID="00000000-0000-4000-8000-000000000040"

echo "This will insert/publish the showcase debate (and its two demo accounts,"
echo "climatologist@example.com / skeptic@example.com, password: pwd123!) on prod."
read -r -p "Type '${CONFIRM_PHRASE}' to continue: " reply
if [[ "$reply" != "$CONFIRM_PHRASE" ]]; then
  echo "Confirmation phrase did not match. Aborting, no changes made."
  exit 1
fi

echo "=== Seeding showcase debate ==="
npx supabase db query --linked --agent=no -f "$SQL_FILE"

echo
echo "=== Verifying published debate ==="
npx supabase db query --linked --agent=no -o table \
  "select id, title, public, published_at from public.debates where id = '${DEBATE_ID}';"
