import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db/database.types";
import type {
  CreateDebateInput,
  CreateNodeInput,
  CreateRelationInput,
  UpdateNodeInput,
  UpdateRelationInput,
} from "./schemas";

type DB = SupabaseClient<Database>;
type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type RelationRow = Database["public"]["Tables"]["relations"]["Row"];
type DebateRow = Database["public"]["Tables"]["debates"]["Row"];

export interface DebateGraph {
  debate: DebateRow;
  nodes: NodeRow[];
  relations: RelationRow[];
}

export async function createDebate(supabase: DB, input: CreateDebateInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_debate_with_root", {
    p_title: input.title,
    p_root_title: input.rootTitle,
    p_root_body: input.rootBody,
  });
  if (error) throw error;
  return data;
}

export async function getDebateGraph(supabase: DB, debateId: string): Promise<DebateGraph | null> {
  const [debateResult, nodesResult, relationsResult] = await Promise.all([
    supabase.from("debates").select("*").eq("id", debateId).maybeSingle(),
    supabase.from("nodes").select("*").eq("debate_id", debateId).order("created_at"),
    supabase.from("relations").select("*").eq("debate_id", debateId),
  ]);

  if (debateResult.error) throw debateResult.error;
  if (!debateResult.data) return null;
  if (nodesResult.error) throw nodesResult.error;
  if (relationsResult.error) throw relationsResult.error;

  return {
    debate: debateResult.data,
    nodes: nodesResult.data,
    relations: relationsResult.data,
  };
}

export async function createStatementNode(
  supabase: DB,
  input: Extract<CreateNodeInput, { nodeKind: "statement" }>,
  authorId: string,
): Promise<NodeRow> {
  const { data, error } = await supabase
    .from("nodes")
    .insert({
      debate_id: input.debateId,
      author_id: authorId,
      kind: "statement",
      position_x: input.positionX,
      position_y: input.positionY,
      metadata: {
        statement_type: input.statementType,
        title: input.title,
        body: input.body ?? null,
        url: input.url ?? null,
      },
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createConnectiveNode(
  supabase: DB,
  input: Extract<CreateNodeInput, { nodeKind: "connective" }>,
  authorId: string,
): Promise<NodeRow> {
  const { data, error } = await supabase
    .from("nodes")
    .insert({
      debate_id: input.debateId,
      author_id: authorId,
      kind: "connective",
      position_x: input.positionX,
      position_y: input.positionY,
      metadata: { op: input.connectiveOp },
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateNode(supabase: DB, nodeId: string, patch: UpdateNodeInput): Promise<NodeRow> {
  const hasMetadataFields =
    patch.title !== undefined ||
    patch.body !== undefined ||
    patch.url !== undefined ||
    patch.statementType !== undefined ||
    patch.connectiveOp !== undefined;

  const positionUpdate: Partial<{ position_x: number; position_y: number }> = {};
  if (patch.positionX !== undefined) positionUpdate.position_x = patch.positionX;
  if (patch.positionY !== undefined) positionUpdate.position_y = patch.positionY;

  if (!hasMetadataFields) {
    const { data, error } = await supabase.from("nodes").update(positionUpdate).eq("id", nodeId).select().single();
    if (error) throw error;
    return data;
  }

  const { data: existing, error: fetchError } = await supabase
    .from("nodes")
    .select("metadata")
    .eq("id", nodeId)
    .single();
  if (fetchError) throw fetchError;

  const existingMeta = existing.metadata as Record<string, Json>;
  const metadataPatch: Record<string, Json> = {};
  if (patch.title !== undefined) metadataPatch.title = patch.title;
  if (patch.body !== undefined) metadataPatch.body = patch.body;
  if (patch.url !== undefined) metadataPatch.url = patch.url;
  if (patch.statementType !== undefined) metadataPatch.statement_type = patch.statementType;
  if (patch.connectiveOp !== undefined) metadataPatch.op = patch.connectiveOp;

  const mergedMetadata: Record<string, Json> = { ...existingMeta, ...metadataPatch };

  const { data, error } = await supabase
    .from("nodes")
    .update({ ...positionUpdate, metadata: mergedMetadata })
    .eq("id", nodeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteNode(supabase: DB, nodeId: string): Promise<void> {
  const { error } = await supabase.from("nodes").delete().eq("id", nodeId);
  if (error) throw error;
}

export async function createRelation(supabase: DB, input: CreateRelationInput, authorId: string): Promise<RelationRow> {
  const { data, error } = await supabase
    .from("relations")
    .insert({
      debate_id: input.debateId,
      author_id: authorId,
      source_node_id: input.sourceNodeId,
      target_node_id: input.targetNodeId,
      kind: input.kind,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRelation(
  supabase: DB,
  relationId: string,
  input: UpdateRelationInput,
): Promise<RelationRow> {
  const { data, error } = await supabase
    .from("relations")
    .update({ kind: input.kind })
    .eq("id", relationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRelation(supabase: DB, relationId: string): Promise<void> {
  const { error } = await supabase.from("relations").delete().eq("id", relationId);
  if (error) throw error;
}
