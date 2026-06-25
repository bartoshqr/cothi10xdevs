import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { normalizeUsername } from "@/lib/username";
import { USER_SEARCH_LIMIT } from "@/lib/exchange/constants";

// Escape LIKE metacharacters so a query containing `_` or `%` matches literally.
// Usernames legitimately contain `_` (pattern allows it); without escaping, `.ilike`
// would treat them as single-character wildcards and return false positives.
function escapeLikeChars(value: string): string {
  return value.replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Resolve a user by exact username (case-insensitive). The S-02 invite-search
// primitive. Uses .eq on the normalized (lowercased) value rather than .ilike:
// usernames may contain `_`, which ILIKE treats as a wildcard — .eq matches it
// literally. Stored usernames are always lowercase (DB CHECK), so eq is exact.
export async function findUserByUsername(
  supabase: SupabaseClient<Database>,
  username: string,
): Promise<{ id: string; username: string } | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("username", normalizeUsername(username))
    .maybeSingle();

  return data;
}

// Resolve a single user's username by id. Surfaces DB errors (if (error) throw)
// instead of swallowing them — a failed read must not silently render as "no
// username". maybeSingle: a genuinely missing profile is null, not an error.
export async function getUsernameById(supabase: SupabaseClient<Database>, userId: string): Promise<string | null> {
  const { data, error } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.username ?? null;
}

// Substring user search for the FR-009 invite dropdown. Returns up to `limit`
// users whose username contains `query` (case-insensitive), excluding `excludeUserId`.
// Empty/whitespace query matches all (pre-populated dropdown on open).
export async function searchUsersByUsername(
  supabase: SupabaseClient<Database>,
  query: string,
  excludeUserId: string,
  limit = USER_SEARCH_LIMIT,
): Promise<{ id: string; username: string }[]> {
  const trimmed = normalizeUsername(query);
  let builder = supabase.from("profiles").select("id, username").neq("id", excludeUserId);
  if (trimmed.length > 0) {
    builder = builder.ilike("username", `%${escapeLikeChars(trimmed)}%`);
  }
  const { data } = await builder.order("username", { ascending: true }).limit(limit);
  return data ?? [];
}
