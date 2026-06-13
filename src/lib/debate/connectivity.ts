/**
 * Compute-at-read graph reachability for the debate map. A statement node "reaches root"
 * when a directed path of relations leads from it to the root claim (the root is a sink —
 * relations point *toward* it). Pure, no Supabase: shared by the store selector (canvas
 * highlight + submit-gate), the summary repository (`isOrphaned` tag), and unit tests.
 */

/** Minimal relation shape: a directed edge `source → target`. */
export interface ConnRelation {
  source: string;
  target: string;
}

/** Minimal node shape: an id, its kind, and (optionally) its author for per-party filtering. */
export interface ConnNode {
  id: string;
  kind: "statement" | "connective";
  authorId?: string;
}

/**
 * BFS from the root over **reversed** edges (`target → source`): every node returned can
 * reach the root by following relations forward. O(nodes + relations). Returns an empty set
 * when there is no root. The root itself is always included.
 */
export function reachableFromRoot({
  relations,
  rootNodeId,
}: {
  relations: ConnRelation[];
  rootNodeId: string | null;
}): Set<string> {
  const reached = new Set<string>();
  if (!rootNodeId) return reached;

  // Reverse adjacency: for a target, which sources point at it.
  const incoming = new Map<string, string[]>();
  for (const r of relations) {
    const sources = incoming.get(r.target);
    if (sources) sources.push(r.source);
    else incoming.set(r.target, [r.source]);
  }

  reached.add(rootNodeId);
  const queue: string[] = [rootNodeId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    for (const source of incoming.get(current) ?? []) {
      if (!reached.has(source)) {
        reached.add(source);
        queue.push(source);
      }
    }
  }
  return reached;
}

/**
 * The ids of statement nodes that are orphaned: not the root and unable to reach it.
 * Connectives are never orphaned (they carry no stance). Pass `authorId` to restrict the
 * result to one party's own statements (the submit-gate and canvas highlight do this).
 */
export function orphanStatementIds({
  nodes,
  relations,
  rootNodeId,
  authorId,
}: {
  nodes: ConnNode[];
  relations: ConnRelation[];
  rootNodeId: string | null;
  authorId?: string;
}): string[] {
  const reached = reachableFromRoot({ relations, rootNodeId });
  return nodes
    .filter((n) => n.kind === "statement")
    .filter((n) => n.id !== rootNodeId)
    .filter((n) => authorId === undefined || n.authorId === authorId)
    .filter((n) => !reached.has(n.id))
    .map((n) => n.id);
}

/**
 * Connective well-formedness: an AND/OR node needs ≥2 inbound `link` relations (operands).
 * Seeds a tally from all connective ids (so ones with zero inbound links are not silently
 * skipped), counts inbound link targets, and returns the ids that fall short — the UI
 * highlights/names them, the server (`openExchange`'s FR-007 gate) rejects on them.
 */
export function incompleteConnectiveIds(connectiveIds: string[], linkTargetNodeIds: string[]): string[] {
  const tally = new Map<string, number>();
  for (const id of connectiveIds) tally.set(id, 0);
  for (const targetId of linkTargetNodeIds) {
    if (tally.has(targetId)) tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
  }
  return [...tally.entries()].filter(([, count]) => count < 2).map(([id]) => id);
}

/** Whole-map predicate built on {@link incompleteConnectiveIds}: true when every connective
 * has ≥2 operands. Used by `openExchange`'s FR-007 gate. */
export function isMapWellFormed(connectiveIds: string[], linkTargetNodeIds: string[]): boolean {
  return incompleteConnectiveIds(connectiveIds, linkTargetNodeIds).length === 0;
}
