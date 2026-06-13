import type { DebateNode, DebateEdge } from "./store";
import { orphanStatementIds, incompleteConnectiveIds } from "@/lib/debate/connectivity";

/** The viewer's own graph problems that block a submit / invite: statements severed from root,
 * and AND/OR connectives with fewer than two operands. Both are computed from the same canvas
 * projection in one pass. */
export interface GraphIssues {
  /** Own statement nodes that no longer reach the root claim. */
  orphanStatementIds: string[];
  /** Own AND/OR connectives with <2 inbound `link` operands (reuses the FR-007 invite gate). */
  incompleteConnectiveIds: string[];
}

/**
 * Adapter between the canvas graph (React Flow `DebateNode`/`DebateEdge`) and the pure graph
 * utils. Derives the root from the `isRoot` flag, drops not-yet-saved nodes and the transient
 * "__pending__" preview edge, then runs both checks. Both the store selectors and
 * `computeTurnGate` call this, so the projection lives in exactly one place and reuses the
 * server-side helpers (`orphanStatementIds`, `incompleteConnectiveIds`) rather than re-deriving
 * the rules client-side.
 *
 * Memoised on the `nodes`/`edges`/`authorId` *references*: every store mutation swaps those
 * arrays for fresh ones, so a stale entry can never be returned, while the repeated per-node
 * calls from `StatementNode`/`ConnectiveNode` within a single render all reuse one computation
 * instead of recomputing it per node (keeps a render O(nodes + relations), not O(nodes²)).
 */
let cache: { nodes: DebateNode[]; edges: DebateEdge[]; authorId: string | undefined; result: GraphIssues } | null =
  null;

export function ownGraphIssues({
  nodes,
  edges,
  authorId,
}: {
  nodes: DebateNode[];
  edges: DebateEdge[];
  /** Restrict to one party's own nodes; omit (pre-exchange) to consider every node. */
  authorId?: string;
}): GraphIssues {
  if (cache?.nodes === nodes && cache.edges === edges && cache.authorId === authorId) {
    return cache.result;
  }
  const liveNodes = nodes.filter((n) => !n.data.pending);
  const rootNode = liveNodes.find((n) => n.type === "statement" && n.data.isRoot);
  const liveEdges = edges.filter((e) => e.id !== "__pending__");

  const orphans = orphanStatementIds({
    nodes: liveNodes.map((n) => ({ id: n.id, kind: n.type, authorId: n.data.authorId })),
    relations: liveEdges.map((e) => ({ source: e.source, target: e.target })),
    rootNodeId: rootNode?.id ?? null,
    authorId,
  });

  // The viewer's own connectives, and every inbound `link` target across the map (operands may
  // be linked by either party — well-formedness counts them all).
  const ownConnectiveIds = liveNodes
    .filter((n) => n.type === "connective" && (authorId === undefined || n.data.authorId === authorId))
    .map((n) => n.id);
  const linkTargets = liveEdges.filter((e) => e.data?.kind === "link").map((e) => e.target);

  const result: GraphIssues = {
    orphanStatementIds: orphans,
    incompleteConnectiveIds: incompleteConnectiveIds(ownConnectiveIds, linkTargets),
  };
  cache = { nodes, edges, authorId, result };
  return result;
}
