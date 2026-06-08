import type { Database } from "@/db/database.types";

type RelationKind = Database["public"]["Enums"]["relation_kind"];
type NodeKind = Database["public"]["Enums"]["node_kind"];

/**
 * Structural rule for a relation's target node (D1). A `link` must point at a
 * connective node; `supports`/`rephrases`/`rebuts` are legal on any target
 * (FR-014/016). Pure so the server (and, optionally, the client) can share it.
 */
export function isLegalRelationTarget(kind: RelationKind, targetKind: NodeKind): boolean {
  if (kind === "link") return targetKind === "connective";
  return true;
}
