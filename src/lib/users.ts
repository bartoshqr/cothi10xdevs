import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { normalizeUsername } from "@/lib/username";

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
