import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/db/database.types";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { isLegalRelationTarget } from "./relationRules";
import type {
  CreateDebateInput,
  CreateNodeInput,
  CreateRelationInput,
  UpdateNodeInput,
  UpdateRelationInput,
} from "./schemas";

type DB = SupabaseClient<Database>;

export type DebateRole = "advocate" | "challenger";
export type DebateListState = "drafting" | "awaiting" | "in_progress" | "closed";

export interface MyDebate {
  id: string;
  title: string;
  root_node_id: string | null;
  root_claim_title: string | null;
  role: DebateRole;
  state: DebateListState;
  exchange_id: string | null;
  other_username: string | null;
  round_count: number | null;
  current_round: number | null;
  created_at: string;
}

export async function listMyDebates(supabase: DB, viewerId: string): Promise<MyDebate[]> {
  // Step 1: all debates visible to this viewer via RLS (owns OR is challenger of open/completed exchange)
  const { data: debates, error: debatesError } = await supabase
    .from("debates")
    .select("id, title, root_node_id, owner_id, created_at");
  if (debatesError) throw debatesError;
  if (debates.length === 0) return [];

  const debateIds = debates.map((d) => d.id);

  // Step 2: all exchanges for these debates (RLS returns advocate- and challenger-side rows)
  const { data: exchanges, error: exchangesError } = await supabase
    .from("exchanges")
    .select("id, debate_id, status, round_count, current_round, advocate_id, challenger_id, created_at")
    .in("debate_id", debateIds);
  if (exchangesError) throw exchangesError;

  // Step 3: build exchange map per debate — representative = open first, else newest completed, else none
  type ExchangeRow = (typeof exchanges)[number];
  const exchangeByDebate = new Map<string, ExchangeRow>();
  for (const ex of exchanges) {
    const existing = exchangeByDebate.get(ex.debate_id);
    const isOpen = ex.status === "pending" || ex.status === "accepted";
    const isCompleted = ex.status === "completed";
    if (!existing) {
      if (isOpen || isCompleted) exchangeByDebate.set(ex.debate_id, ex);
    } else {
      const existingIsOpen = existing.status === "pending" || existing.status === "accepted";
      if (isOpen && !existingIsOpen) {
        // open beats completed
        exchangeByDebate.set(ex.debate_id, ex);
      } else if (!existingIsOpen && isCompleted) {
        // prefer newer completed
        if (new Date(ex.created_at) > new Date(existing.created_at)) {
          exchangeByDebate.set(ex.debate_id, ex);
        }
      }
    }
  }

  // Step 4: collect other-party ids for username resolution
  const otherPartyIds = new Set<string>();
  for (const debate of debates) {
    const isAdvocate = debate.owner_id === viewerId;
    const ex = exchangeByDebate.get(debate.id);
    if (ex) {
      otherPartyIds.add(isAdvocate ? ex.challenger_id : ex.advocate_id);
    }
  }
  const usernameById = new Map<string, string>();
  if (otherPartyIds.size > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", [...otherPartyIds]);
    if (profilesError) throw profilesError;
    for (const p of profiles) {
      usernameById.set(p.id, p.username);
    }
  }

  // Step 5: resolve root-claim titles
  const rootNodeIds = debates.map((d) => d.root_node_id).filter((id): id is string => id !== null);
  const rootTitleById = new Map<string, string | null>();
  if (rootNodeIds.length > 0) {
    const { data: rootNodes, error: rootError } = await supabase
      .from("nodes")
      .select("id, metadata")
      .in("id", rootNodeIds);
    if (rootError) throw rootError;
    for (const node of rootNodes) {
      const meta = node.metadata as { title?: string } | null;
      rootTitleById.set(node.id, meta?.title ?? null);
    }
  }

  // Step 6: derive role + state per debate and shape into MyDebate[]
  return debates.map((debate) => {
    const role: DebateRole = debate.owner_id === viewerId ? "advocate" : "challenger";
    const ex = exchangeByDebate.get(debate.id) ?? null;

    let state: DebateListState;
    if (!ex) {
      state = "drafting";
    } else if (ex.status === "pending") {
      state = "awaiting";
    } else if (ex.status === "accepted") {
      state = "in_progress";
    } else {
      state = "closed";
    }

    const otherPartyId = ex ? (role === "advocate" ? ex.challenger_id : ex.advocate_id) : null;
    const rootNodeId = debate.root_node_id;

    return {
      id: debate.id,
      title: debate.title,
      root_node_id: rootNodeId,
      root_claim_title: rootNodeId ? (rootTitleById.get(rootNodeId) ?? null) : null,
      role,
      state,
      exchange_id: ex?.id ?? null,
      other_username: otherPartyId ? (usernameById.get(otherPartyId) ?? null) : null,
      round_count: ex?.round_count ?? null,
      current_round: ex?.current_round ?? null,
      created_at: debate.created_at,
    };
  });
}
type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];
type RelationRow = Database["public"]["Tables"]["relations"]["Row"];
type DebateRow = Database["public"]["Tables"]["debates"]["Row"];

export interface DebateGraph {
  debate: DebateRow;
  nodes: NodeRow[];
  relations: RelationRow[];
}

export async function deleteDebate(supabase: DB, debateId: string): Promise<void> {
  const { data, error } = await supabase.from("debates").delete().eq("id", debateId).select("id");
  if (error) throw error;
  if (data.length === 0) throw new NotFoundError();
}

export async function createDebate(supabase: DB, input: CreateDebateInput): Promise<string> {
  // The RPC also asserts auth.uid() is not null as DB-layer defense-in-depth.
  // That branch is unreachable here — withAuth guarantees a user before this runs
  // — so it has no app-layer 401 mapping; if it ever fired it surfaces as a 500 (F7).
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
  // D3-3b: the designated root claim cannot be demoted away from `claim`. If this
  // patch would set the root's statement_type to anything else, reject it app-side
  // (422) before the merge — mirrors the D1 link guard's app-layer placement. Other
  // fields (title/body/position) stay patchable, and non-root nodes demote freely.
  if (patch.statementType !== undefined && patch.statementType !== "claim") {
    const { data: rootDebate, error: rootError } = await supabase
      .from("debates")
      .select("id")
      .eq("root_node_id", nodeId)
      .maybeSingle();
    if (rootError) throw rootError;
    if (rootDebate) {
      throw new ValidationError("The root claim cannot be demoted; set a different claim as the root instead.");
    }
  }

  // Metadata fields are merged DB-side via patch_node (metadata || patch) so the
  // read-modify-write is atomic — see migration 20260605000002 (impl-review F2).
  const metadataPatch: Record<string, Json> = {};
  if (patch.title !== undefined) metadataPatch.title = patch.title;
  if (patch.body !== undefined) metadataPatch.body = patch.body;
  if (patch.url !== undefined) metadataPatch.url = patch.url;
  if (patch.statementType !== undefined) metadataPatch.statement_type = patch.statementType;
  if (patch.connectiveOp !== undefined) metadataPatch.op = patch.connectiveOp;

  // Must be called with the per-request anon/RLS client (not a service-role client):
  // patch_node_and_invalidate is SECURITY DEFINER and bypasses RLS on the marks
  // invalidation, so it relies on auth.uid() being set to authorize the edit. It also
  // trusts that the root-demotion guard above ran first — keep both checks at this
  // call site. See migration 20260612000002 (impl-review F1/F2).
  const { data, error } = await supabase
    .rpc("patch_node_and_invalidate", {
      p_node_id: nodeId,
      p_metadata_patch: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined,
      p_position_x: patch.positionX,
      p_position_y: patch.positionY,
    })
    .maybeSingle();
  if (error) throw error;
  // patch_node returns SETOF, so maybeSingle yields null when the id is unknown or
  // RLS-scoped out — map that to a 404 rather than returning an all-null node (F4).
  if (!data) throw new NotFoundError();
  return data;
}

export async function deleteNode(supabase: DB, nodeId: string): Promise<void> {
  const { data, error } = await supabase.from("nodes").delete().eq("id", nodeId).select("id");
  if (error) {
    // D3-3a: the debate's root_node_id FK is `deferrable initially deferred`, so
    // deleting the designated root trips a foreign-key violation (SQLSTATE 23503)
    // at commit. Map that to a clean 409 backstop instead of leaking the raw FK
    // error as a 500 — the UI blocks this first, but the API must not 500 either.
    // ASSUMPTION: root_node_id is the only inbound FK to `nodes` (relations
    // cascade), so any 23503 here is the root-delete case. If another table ever
    // FKs to nodes without ON DELETE CASCADE, narrow this to the constraint name.
    if (error.code === "23503")
      throw new ConflictError("The root claim cannot be deleted; set a different claim as the root instead.");
    throw error;
  }
  if (data.length === 0) throw new NotFoundError(); // nothing deleted → 404 (F4)
}

export async function setDebateRoot(supabase: DB, debateId: string, nodeId: string): Promise<DebateRow> {
  // D3-3c: re-designate the debate's root. Pre-check the target app-side (mirrors
  // the D1 link guard): an unknown node/debate pair → NotFoundError (404); a
  // non-statement target (e.g. a connective) → ValidationError (422). The atomic
  // effects (coerce role → claim, strip outgoing relations, move root_node_id)
  // run inside the set_debate_root RPC.
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .select("kind")
    .eq("id", nodeId)
    .eq("debate_id", debateId)
    .maybeSingle();
  if (nodeError) throw nodeError;
  if (!node) throw new NotFoundError();
  if (node.kind !== "statement") {
    throw new ValidationError("Only a statement node can be set as the root claim.");
  }

  const { data, error } = await supabase
    .rpc("set_debate_root", { p_debate_id: debateId, p_node_id: nodeId })
    .maybeSingle();
  if (error) throw error;
  // SETOF: an unknown pair yields an empty set → null (lessons §4), not an all-null row.
  if (!data) throw new NotFoundError();
  return data;
}

export async function createRelation(supabase: DB, input: CreateRelationInput, authorId: string): Promise<RelationRow> {
  // D1: a `link` must target a connective. Load the target's kind and reject an
  // illegal pairing app-side (422) before inserting — the rule can't be expressed
  // as a simple column/check constraint, and the canvas guard can be bypassed via
  // the API. Unknown target → NotFoundError (404), consistent with Risk #6.
  const { data: target, error: targetError } = await supabase
    .from("nodes")
    .select("kind")
    .eq("id", input.targetNodeId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new NotFoundError();
  if (!isLegalRelationTarget(input.kind, target.kind)) {
    throw new ValidationError(`A '${input.kind}' relation must target a connective node.`);
  }

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
  if (error) {
    // A duplicate directed relation trips the unique constraint relations_uniq_pair
    // (SQLSTATE 23505): the two nodes are already connected in this direction. Map it
    // to a 409 with a safe message instead of leaking the raw constraint text as a 500.
    if (error.code === "23505") throw new ConflictError("These two nodes are already connected.");
    throw error;
  }
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
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError(); // unknown id or RLS-scoped out → 404 (F4)
  return data;
}

export async function deleteRelation(supabase: DB, relationId: string): Promise<void> {
  const { data, error } = await supabase.from("relations").delete().eq("id", relationId).select("id");
  if (error) throw error;
  if (data.length === 0) throw new NotFoundError(); // nothing deleted → 404 (F4)
}
