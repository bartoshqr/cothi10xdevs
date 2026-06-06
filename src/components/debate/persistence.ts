import type { Database } from "@/db/database.types";
import type { CreateNodeInput, CreateRelationInput, UpdateNodeInput, UpdateRelationInput } from "@/lib/debate/schemas";
import type { DebateGraph } from "@/lib/debate/repository";

type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type RelationRow = Database["public"]["Tables"]["relations"]["Row"];

/**
 * Thin fetch wrappers around the Phase 2 CRUD endpoints. They carry the
 * browser's cookie session automatically (same-origin), which `getAuthUser`
 * resolves server-side. Each throws on a non-2xx response so the store's
 * optimistic actions can reconcile or roll back in a single `.catch`.
 */

function expectOk(res: Response, action: string): void {
  if (!res.ok) {
    throw new Error(`${action} failed (${res.status})`);
  }
}

export async function apiCreateNode(debateId: string, input: CreateNodeInput): Promise<NodeRow> {
  const res = await fetch(`/api/debates/${debateId}/nodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  expectOk(res, "Create node");
  return res.json() as Promise<NodeRow>;
}

export async function apiUpdateNode(debateId: string, nodeId: string, patch: UpdateNodeInput): Promise<NodeRow> {
  const res = await fetch(`/api/debates/${debateId}/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  expectOk(res, "Save node");
  return res.json() as Promise<NodeRow>;
}

export async function apiDeleteNode(debateId: string, nodeId: string): Promise<void> {
  const res = await fetch(`/api/debates/${debateId}/nodes/${nodeId}`, { method: "DELETE" });
  expectOk(res, "Delete node");
}

export async function apiCreateRelation(debateId: string, input: CreateRelationInput): Promise<RelationRow> {
  const res = await fetch(`/api/debates/${debateId}/relations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  expectOk(res, "Create relation");
  return res.json() as Promise<RelationRow>;
}

export async function apiUpdateRelation(
  debateId: string,
  relationId: string,
  input: UpdateRelationInput,
): Promise<RelationRow> {
  const res = await fetch(`/api/debates/${debateId}/relations/${relationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  expectOk(res, "Save relation");
  return res.json() as Promise<RelationRow>;
}

export async function apiDeleteRelation(debateId: string, relationId: string): Promise<void> {
  const res = await fetch(`/api/debates/${debateId}/relations/${relationId}`, { method: "DELETE" });
  expectOk(res, "Delete relation");
}

export async function apiGetGraph(debateId: string): Promise<DebateGraph> {
  const res = await fetch(`/api/debates/${debateId}`);
  expectOk(res, "Load debate");
  return res.json() as Promise<DebateGraph>;
}
