import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { NotFoundError } from "@/lib/errors";
import type { MarkStance } from "./schemas";

type DB = SupabaseClient<Database>;
type MarkRow = Database["public"]["Tables"]["marks"]["Row"];

interface UpsertMarkArgs {
  supabase: DB;
  debateId: string;
  nodeId: string;
  markerId: string;
  stance: MarkStance;
}

export async function upsertMark({ supabase, debateId, nodeId, markerId, stance }: UpsertMarkArgs): Promise<MarkRow> {
  const { data, error } = await supabase
    .from("marks")
    .upsert(
      { debate_id: debateId, node_id: nodeId, marker_id: markerId, stance, updated_at: new Date().toISOString() },
      { onConflict: "node_id,marker_id" },
    )
    .select()
    .maybeSingle();

  if (error) {
    // FK violation: unknown node_id (23503); RLS block also yields no row
    if (error.code === "23503") throw new NotFoundError();
    throw error;
  }
  // Zero rows = RLS filtered it out (not a member, wrong turn, or non-statement node)
  if (!data) throw new NotFoundError();
  return data;
}
