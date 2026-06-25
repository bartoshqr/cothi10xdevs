#!/usr/bin/env bash
# Wipes ALL data in the linked prod Supabase project:
# public.profiles, debates, nodes, relations, exchanges, marks, and auth.users.
# Irreversible. Requires typing the confirmation phrase to proceed.
set -euo pipefail

SQL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/reset_prod.sql"
CONFIRM_PHRASE="RESET PROD"

count_query="select 'profiles' t, count(*) from public.profiles
union all select 'debates', count(*) from public.debates
union all select 'nodes', count(*) from public.nodes
union all select 'relations', count(*) from public.relations
union all select 'exchanges', count(*) from public.exchanges
union all select 'marks', count(*) from public.marks
union all select 'auth.users', count(*) from auth.users;"

echo "=== Row counts BEFORE reset ==="
npx supabase db query --linked --agent=no -o table "$count_query"

echo
read -r -p "This will permanently delete ALL rows above from prod. Type '${CONFIRM_PHRASE}' to continue: " reply
if [[ "$reply" != "$CONFIRM_PHRASE" ]]; then
  echo "Confirmation phrase did not match. Aborting, no changes made."
  exit 1
fi

echo "=== Running reset ==="
npx supabase db query --linked --agent=no -f "$SQL_FILE"

echo
echo "=== Row counts AFTER reset ==="
npx supabase db query --linked --agent=no -o table "$count_query"
