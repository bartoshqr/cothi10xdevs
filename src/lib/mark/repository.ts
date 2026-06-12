import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { NotFoundError } from "@/lib/errors";
import type { MarkStance } from "./schemas";
import type { MarkState } from "@/components/debate/mapVisualLanguage";

type DB = SupabaseClient<Database>;
type MarkRow = Database["public"]["Tables"]["marks"]["Row"];

interface UpsertMarkArgs {
  supabase: DB;
  debateId: string;
  nodeId: string;
  markerId: string;
  stance: MarkStance;
}

interface GetDebateMarksArgs {
  supabase: DB;
  debateId: string;
}

// Pre-load every mark in the debate, keyed by node id, so the board can hydrate the mark
// controls server-side. RLS lets a member read all marks. In round 1 only one party marks
// (the challenger marks the advocate's statements), so node→stance is unambiguous and
// serves both views: the challenger sees their own marks (interactive on their turn), the
// advocate sees the challenger's marks read-only on their own statements. Interactivity is
// gated by `canMarkNode` (turn + ownership), not by who authored the mark — so no marker
// identity is needed here. The two-stance case (both parties marking) is S-04.
export async function getDebateMarks({
  supabase,
  debateId,
}: GetDebateMarksArgs): Promise<Partial<Record<string, MarkState>>> {
  const { data, error } = await supabase.from("marks").select("node_id, stance, valid").eq("debate_id", debateId);
  if (error) throw error;

  const marks: Partial<Record<string, MarkState>> = {};
  for (const row of data) {
    marks[row.node_id] = { stance: row.stance, valid: row.valid };
  }
  return marks;
}

export async function upsertMark({ supabase, debateId, nodeId, markerId, stance }: UpsertMarkArgs): Promise<MarkRow> {
  const { data, error } = await supabase
    .from("marks")
    .upsert(
      // valid:true — a marker setting their own stance is a fresh evaluation, so it
      // revalidates a previously-invalidated mark (S-05 re-evaluation). The submit_turn
      // gate counts only valid=true marks; without this, a re-marked stale mark stays
      // valid=false and the server keeps rejecting the turn the UI thinks is complete.
      {
        debate_id: debateId,
        node_id: nodeId,
        marker_id: markerId,
        stance,
        valid: true,
        updated_at: new Date().toISOString(),
      },
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
