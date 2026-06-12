import type { Database } from "@/db/database.types";
import type { CreateNodeInput, CreateRelationInput, UpdateNodeInput, UpdateRelationInput } from "@/lib/debate/schemas";
import type { DebateGraph } from "@/lib/debate/repository";
import type { DivergenceSummary } from "@/lib/summary/classify";
import type { MarkStance } from "./mapVisualLanguage";
import { ApiError } from "./apiError";

type MarkRow = Database["public"]["Tables"]["marks"]["Row"];
type ExchangeRow = Database["public"]["Tables"]["exchanges"]["Row"];

type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type RelationRow = Database["public"]["Tables"]["relations"]["Row"];
type DebateRow = Database["public"]["Tables"]["debates"]["Row"];

/**
 * Thin fetch wrappers around the Phase 2 CRUD endpoints. They carry the
 * browser's cookie session automatically (same-origin), which `getAuthUser`
 * resolves server-side. Each throws on a non-2xx response so the store's
 * optimistic actions can reconcile or roll back in a single `.catch`.
 */

async function expectOk(res: Response, action: string): Promise<void> {
  if (res.ok) return;
  // Surface the server's safe message (api.ts returns `{ error }` for 4xx) so the
  // store banner can show e.g. "These two nodes are already connected." instead of a
  // bare status. Fall back to a generic line if the body isn't JSON. The status is
  // carried on ApiError so callers can branch (e.g. reconcile only on a 409).
  let message = `${action} failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) message = body.error;
  } catch {
    // non-JSON / empty body — keep the status fallback
  }
  throw new ApiError(message, res.status);
}

export async function apiCreateNode(debateId: string, input: CreateNodeInput): Promise<NodeRow> {
  const res = await fetch(`/api/debates/${debateId}/nodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await expectOk(res, "Create node");
  return res.json() as Promise<NodeRow>;
}

export async function apiUpdateNode(debateId: string, nodeId: string, patch: UpdateNodeInput): Promise<NodeRow> {
  const res = await fetch(`/api/debates/${debateId}/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await expectOk(res, "Save node");
  return res.json() as Promise<NodeRow>;
}

export async function apiDeleteNode(debateId: string, nodeId: string): Promise<void> {
  const res = await fetch(`/api/debates/${debateId}/nodes/${nodeId}`, { method: "DELETE" });
  await expectOk(res, "Delete node");
}

export async function apiCreateRelation(debateId: string, input: CreateRelationInput): Promise<RelationRow> {
  const res = await fetch(`/api/debates/${debateId}/relations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await expectOk(res, "Create relation");
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
  await expectOk(res, "Save relation");
  return res.json() as Promise<RelationRow>;
}

export async function apiDeleteRelation(debateId: string, relationId: string): Promise<void> {
  const res = await fetch(`/api/debates/${debateId}/relations/${relationId}`, { method: "DELETE" });
  await expectOk(res, "Delete relation");
}

/** D3-3c: persist a root re-designation. Returns the updated debate row. */
export async function apiSetDebateRoot(debateId: string, nodeId: string): Promise<DebateRow> {
  const res = await fetch(`/api/debates/${debateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootNodeId: nodeId }),
  });
  await expectOk(res, "Set root claim");
  return res.json() as Promise<DebateRow>;
}

export async function apiGetGraph(debateId: string): Promise<DebateGraph> {
  const res = await fetch(`/api/debates/${debateId}`);
  await expectOk(res, "Load debate");
  return res.json() as Promise<DebateGraph>;
}

export async function apiGetMarks(debateId: string): Promise<Partial<Record<string, MarkStance>>> {
  const res = await fetch(`/api/debates/${debateId}/marks`);
  await expectOk(res, "Load marks");
  return res.json() as Promise<Partial<Record<string, MarkStance>>>;
}

export async function apiGetSummary(debateId: string): Promise<DivergenceSummary> {
  const res = await fetch(`/api/debates/${debateId}/summary`);
  await expectOk(res, "Load summary");
  return res.json() as Promise<DivergenceSummary>;
}

export async function apiUpsertMark(debateId: string, nodeId: string, stance: string): Promise<MarkRow> {
  const res = await fetch(`/api/debates/${debateId}/marks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId, stance }),
  });
  await expectOk(res, "Save mark");
  return res.json() as Promise<MarkRow>;
}

export async function apiSubmitTurn(exchangeId: string): Promise<ExchangeRow> {
  const res = await fetch(`/api/exchanges/${exchangeId}/submit-turn`, { method: "POST" });
  await expectOk(res, "Submit turn");
  return res.json() as Promise<ExchangeRow>;
}
