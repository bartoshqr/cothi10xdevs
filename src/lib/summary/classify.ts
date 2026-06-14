import type { Database } from "@/db/database.types";

type StatementType = Database["public"]["Enums"]["statement_type"];
type NodeKind = Database["public"]["Enums"]["node_kind"];
type MarkStance = Database["public"]["Enums"]["mark_stance"];

/** A node fed to the classifier. Connectives carry a null `statementType` and are skipped. */
export interface ClassifyNode {
  id: string;
  kind: NodeKind;
  statementType: StatementType | null;
  title: string;
  authorId: string;
  /** True when the statement no longer reaches the root claim (orphaned). Carried through to
   * the summary item so the reader sees it needs attention; bucketing is unaffected. Optional
   * so a caller that doesn't compute connectivity (unit tests) simply omits it. */
  isOrphaned?: boolean;
}

/** A node's single counterpart mark. `valid` lets a future invalidated mark be ignored (S-05). */
export interface ClassifyMark {
  stance: MarkStance;
  valid: boolean;
}

export interface ClassifyInput {
  nodes: ClassifyNode[];
  marks: Partial<Record<string, ClassifyMark>>;
}

export interface SummaryItem {
  id: string;
  statementType: StatementType;
  title: string;
  /** Node author — lets the UI group each bucket into "mine" vs "counterpart". */
  authorId: string;
  /** Carried from `ClassifyNode`: the statement is orphaned (severed from root). The UI tags it;
   * the stance bucket is unchanged. Optional/undefined when connectivity wasn't computed. */
  isOrphaned?: boolean;
}

export type DivergenceGap = "factual" | "values";

export interface DivergenceSummary {
  /** Statements the counterpart Accepted — mutual common ground. */
  commonGround: SummaryItem[];
  /** Statements the counterpart Challenged, tagged factual (data-level) vs values (premise-level). */
  openDivergences: (SummaryItem & { gap: DivergenceGap })[];
  /** Statements the counterpart Abstained on, or never marked — unresolved positions. */
  unresolved: SummaryItem[];
}

// PRD §Business-Logic: contested Source/Data/Backing → factual gap (different evidence);
// contested Warrant/Claim → premise/values gap. Rebuttal is decided as a values gap (it
// attacks the logic, not the evidence).
function gapFor(statementType: StatementType): DivergenceGap {
  switch (statementType) {
    case "source":
    case "data":
    case "backing":
      return "factual";
    case "warrant":
    case "claim":
    case "rebuttal":
      return "values";
  }
}

/**
 * Deterministically bucket every statement node by its single counterpart mark.
 *
 * Marks are disjoint per node (a node is marked only by its non-author), so `node_id → mark`
 * is unambiguous. Connective nodes carry no mark and are excluded. A statement lacking a
 * `valid` mark is treated as **unresolved** (Abstain-equivalent) — the summary never silently
 * drops a statement. Pure and O(nodes + marks); no Supabase import.
 */
export function classifyDivergence({ nodes, marks }: ClassifyInput): DivergenceSummary {
  const summary: DivergenceSummary = { commonGround: [], openDivergences: [], unresolved: [] };

  for (const node of nodes) {
    if (node.kind !== "statement" || node.statementType === null) continue;
    const item: SummaryItem = {
      id: node.id,
      statementType: node.statementType,
      title: node.title,
      authorId: node.authorId,
      isOrphaned: node.isOrphaned,
    };

    const mark = marks[node.id];
    if (!mark?.valid) {
      summary.unresolved.push(item);
      continue;
    }

    switch (mark.stance) {
      case "accept":
        summary.commonGround.push(item);
        break;
      case "challenge":
        summary.openDivergences.push({ ...item, gap: gapFor(node.statementType) });
        break;
      case "abstain":
        summary.unresolved.push(item);
        break;
    }
  }

  return summary;
}
