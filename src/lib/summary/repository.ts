import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { getDebateExchange } from "@/lib/exchange/repository";
import { classifyDivergence, type ClassifyMark, type ClassifyNode, type DivergenceSummary } from "./classify";

type DB = SupabaseClient<Database>;

interface GetDivergenceSummaryArgs {
  supabase: DB;
  debateId: string;
}

// Statement node metadata shape (mirrors createStatementNode in the debate repository).
interface StatementMetadata {
  statement_type?: Database["public"]["Enums"]["statement_type"];
  title?: string;
}

/**
 * Build the deterministic divergence summary for a debate, or `null` when it is not yet
 * available. "Not available" covers both the unmet round gate and an RLS-scoped-out / unknown
 * debate (the exchange read returns null for a non-member). The endpoint maps `null` → 404.
 *
 * The gate: a summary exists once at least one round has fully closed — `status = 'completed'`
 * (a round_count=1 exchange) or `current_round >= 2` (a multi-round exchange that advanced).
 * All reads go through the anon-key/RLS client, so the result is pair-scoped exactly like
 * `getDebateMarks`. Marks are filtered to `valid = true` (forward-compatible with S-05
 * invalidation; every round-1 mark is valid).
 */
export async function getDivergenceSummary({
  supabase,
  debateId,
}: GetDivergenceSummaryArgs): Promise<DivergenceSummary | null> {
  const exchange = await getDebateExchange(supabase, debateId);
  if (!exchange) return null;

  const gateMet = exchange.status === "completed" || exchange.currentRound >= 2;
  if (!gateMet) return null;

  const [nodesResult, marksResult] = await Promise.all([
    supabase.from("nodes").select("id, kind, author_id, metadata").eq("debate_id", debateId),
    supabase.from("marks").select("node_id, stance, valid").eq("debate_id", debateId).eq("valid", true),
  ]);
  if (nodesResult.error) throw nodesResult.error;
  if (marksResult.error) throw marksResult.error;

  const nodes: ClassifyNode[] = nodesResult.data.map((n) => {
    const meta = (n.metadata as StatementMetadata | null) ?? {};
    return {
      id: n.id,
      kind: n.kind,
      statementType: meta.statement_type ?? null,
      title: meta.title ?? "",
      authorId: n.author_id,
    };
  });

  const marks: Partial<Record<string, ClassifyMark>> = {};
  for (const m of marksResult.data) {
    marks[m.node_id] = { stance: m.stance, valid: m.valid };
  }

  return classifyDivergence({ nodes, marks });
}
