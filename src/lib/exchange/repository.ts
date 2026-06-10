import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { OpenExchangeInput } from "./schemas";

type DB = SupabaseClient<Database>;
type ExchangeRow = Database["public"]["Tables"]["exchanges"]["Row"];

// Pure helper shared with Phase-4 UI flag: reject if any connective node has <2
// inbound link relations. Seeds a tally from all connective ids (so ones with
// zero inbound links are not silently skipped) and counts inbound link targets.
export function isMapWellFormed(connectiveIds: string[], linkTargetNodeIds: string[]): boolean {
  const tally = new Map<string, number>();
  for (const id of connectiveIds) tally.set(id, 0);
  for (const targetId of linkTargetNodeIds) {
    if (tally.has(targetId)) tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
  }
  for (const count of tally.values()) {
    if (count < 2) return false;
  }
  return true;
}

export async function openExchange(supabase: DB, input: OpenExchangeInput, advocateId: string): Promise<ExchangeRow> {
  // (a) Load the debate — null means unknown or RLS-scoped out.
  const { data: debate, error: debateError } = await supabase
    .from("debates")
    .select("id, root_node_id")
    .eq("id", input.debateId)
    .maybeSingle();
  if (debateError) throw debateError;
  if (!debate) throw new NotFoundError();

  // (b) FR-007 gate part 1: root claim must exist.
  if (!debate.root_node_id) {
    throw new ValidationError("The debate must have a root Claim before you can invite a challenger.");
  }

  // (c) FR-007 gate part 2: every connective must have ≥2 inbound link relations.
  // Two flat selects — PostgREST can't express LEFT JOIN … GROUP BY … HAVING.
  const [connectivesResult, linksResult] = await Promise.all([
    supabase.from("nodes").select("id").eq("debate_id", input.debateId).eq("kind", "connective"),
    supabase.from("relations").select("target_node_id").eq("debate_id", input.debateId).eq("kind", "link"),
  ]);
  if (connectivesResult.error) throw connectivesResult.error;
  if (linksResult.error) throw linksResult.error;

  const connectiveIds = connectivesResult.data.map((n) => n.id);
  const linkTargets = linksResult.data.map((r) => r.target_node_id);
  if (!isMapWellFormed(connectiveIds, linkTargets)) {
    throw new ValidationError(
      "Every AND/OR group needs at least two operands before you can invite a challenger. Please adjust your graph",
    );
  }

  // (d) Self-invite guard — defense in depth (search endpoint excludes caller; DB CHECK backstops).
  if (input.challengerId === advocateId) {
    throw new ValidationError("You cannot invite yourself as the challenger.");
  }

  // (e) Insert the exchange row; map partial-unique violation (one open exchange per debate) → 409.
  const { data, error } = await supabase
    .from("exchanges")
    .insert({
      debate_id: input.debateId,
      advocate_id: advocateId,
      challenger_id: input.challengerId,
      round_count: input.roundCount,
      // status defaults to 'pending', current_round to 1, current_turn to 'challenger' (DB defaults)
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new ConflictError("An exchange is already open on this debate.");
    throw error;
  }
  return data;
}

export async function respondToInvite(supabase: DB, exchangeId: string, accept: boolean): Promise<ExchangeRow> {
  // RLS exchanges_update enforces challenger identity and status = 'pending'.
  // No result (null) = unknown id, already responded, or not-yours-via-RLS → 404.
  const { data, error } = await supabase
    .from("exchanges")
    .update({ status: accept ? "accepted" : "declined", responded_at: new Date().toISOString() })
    .eq("id", exchangeId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError();
  return data;
}

export interface ExchangeStatus {
  status: Database["public"]["Enums"]["exchange_status"];
  challengerUsername: string | null;
  roundCount: number;
}

// Read the current state of an exchange for the freshness poll + the advocate's
// status line. RLS scopes the row to the advocate or the challenger; the join to
// profiles resolves the challenger's username. null = unknown id or RLS-scoped out.
export async function getExchangeStatus(supabase: DB, exchangeId: string): Promise<ExchangeStatus | null> {
  const { data, error } = await supabase
    .from("exchanges")
    .select("status, round_count, challenger_id")
    .eq("id", exchangeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", data.challenger_id)
    .maybeSingle();
  if (profileError) throw profileError;

  return {
    status: data.status,
    challengerUsername: profile?.username ?? null,
    roundCount: data.round_count,
  };
}

export interface DebateExchange {
  id: string;
  status: "pending" | "accepted";
  roundCount: number;
  currentRound: number;
  currentTurn: Database["public"]["Enums"]["turn_actor"];
  advocateId: string;
  advocateUsername: string | null;
  challengerId: string;
  challengerUsername: string | null;
}

// Load a debate's single open exchange (pending or accepted) with both participant
// usernames resolved — serves the advocate's invite status line and the challenger's
// header alike. There is at most one open exchange per debate (partial-unique
// constraint), so a debate id is enough. RLS scopes the row to participants; null =
// no open exchange (or RLS-scoped out). Each caller reads the side it needs.
export async function getDebateExchange(supabase: DB, debateId: string): Promise<DebateExchange | null> {
  const { data: exchange, error } = await supabase
    .from("exchanges")
    .select("id, status, round_count, current_round, current_turn, advocate_id, challenger_id")
    .eq("debate_id", debateId)
    .in("status", ["pending", "accepted"])
    .maybeSingle();
  if (error) throw error;
  if (!exchange) return null;

  // Resolve both usernames in one read. profiles_select_authenticated lets any
  // authed user read these, so both rows come back regardless of viewer role.
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, username")
    .in("id", [exchange.advocate_id, exchange.challenger_id]);
  if (profileError) throw profileError;

  const usernameById = new Map(profiles.map((p) => [p.id, p.username]));
  return {
    id: exchange.id,
    status: exchange.status as "pending" | "accepted",
    roundCount: exchange.round_count,
    currentRound: exchange.current_round,
    currentTurn: exchange.current_turn,
    advocateId: exchange.advocate_id,
    advocateUsername: usernameById.get(exchange.advocate_id) ?? null,
    challengerId: exchange.challenger_id,
    challengerUsername: usernameById.get(exchange.challenger_id) ?? null,
  };
}

// Advocate revokes a still-pending invite. Deletes the row (re-opening the
// one-open-exchange slot so the advocate can re-invite). RLS exchanges_delete
// enforces advocate identity AND status='pending'; the explicit filters here
// surface a clean 404 (null) for unknown / not-yours / already-responded.
export async function revokeInvite(supabase: DB, exchangeId: string, advocateId: string): Promise<void> {
  const { data, error } = await supabase
    .from("exchanges")
    .delete()
    .eq("id", exchangeId)
    .eq("advocate_id", advocateId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  if (data.length === 0) throw new NotFoundError();
}

export interface ChallengerInvite {
  id: string;
  debate_id: string;
  debate_title: string;
  debate_root_node_id: string | null;
  debate_root_claim_title: string | null;
  debate_root_claim_body: string | null;
  advocate_id: string;
  round_count: number;
  status: "pending" | "accepted";
  created_at: string;
}

// Returns the challenger's pending and accepted exchanges so the inbox can show
// both "awaiting response" rows (with Accept/Decline) and "enter debate" rows.
export async function submitTurn(supabase: DB, exchangeId: string): Promise<ExchangeRow> {
  const { data, error } = await supabase.rpc("submit_turn", { p_exchange_id: exchangeId }).maybeSingle();
  if (error) {
    // submit_turn raises a typed error when the mark gate fails (incomplete mark set).
    // The RPC uses SQLSTATE P0001 (raise_exception) with a message naming the unmarked count.
    // Map to ConflictError so withAuth returns 409.
    if (error.code === "P0001") throw new ConflictError(error.message);
    throw error;
  }
  if (!data) throw new NotFoundError();
  return data;
}

export async function listInvites(supabase: DB, userId: string): Promise<ChallengerInvite[]> {
  const { data: exchanges, error } = await supabase
    .from("exchanges")
    .select("id, debate_id, round_count, created_at, advocate_id, status")
    .eq("challenger_id", userId)
    .in("status", ["pending", "accepted"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (exchanges.length === 0) return [];

  const debateIds = [...new Set(exchanges.map((e) => e.debate_id))];
  const { data: debates, error: debatesError } = await supabase
    .from("debates")
    .select("id, title, root_node_id")
    .in("id", debateIds);
  if (debatesError) throw debatesError;

  const debateById = new Map(debates.map((d) => [d.id, d]));

  // Fetch root claim content (title + body) for debates that have a root node.
  const rootNodeIds = debates.map((d) => d.root_node_id).filter((id): id is string => id !== null);
  const rootNodeById = new Map<string, { title: string | null; body: string | null }>();
  if (rootNodeIds.length > 0) {
    const { data: rootNodes, error: rootError } = await supabase
      .from("nodes")
      .select("id, metadata")
      .in("id", rootNodeIds);
    if (rootError) throw rootError;
    for (const node of rootNodes) {
      const meta = node.metadata as { title?: string; body?: string } | null;
      rootNodeById.set(node.id, { title: meta?.title ?? null, body: meta?.body ?? null });
    }
  }

  return exchanges.map((row) => {
    const debate = debateById.get(row.debate_id);
    const rootNodeId = debate?.root_node_id ?? null;
    const rootClaim = rootNodeId ? (rootNodeById.get(rootNodeId) ?? null) : null;
    return {
      id: row.id,
      debate_id: row.debate_id,
      debate_title: debate?.title ?? "",
      debate_root_node_id: rootNodeId,
      debate_root_claim_title: rootClaim?.title ?? null,
      debate_root_claim_body: rootClaim?.body ?? null,
      advocate_id: row.advocate_id,
      round_count: row.round_count,
      status: row.status as "pending" | "accepted",
      created_at: row.created_at,
    };
  });
}
