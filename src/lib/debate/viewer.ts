import type { User } from "@supabase/supabase-js";
import type { ViewerContext } from "@/components/debate/store";
import type { DebateGraph } from "@/lib/debate/repository";
import type { DebateExchange } from "@/lib/exchange/repository";

interface DeriveViewerArgs {
  user: User | null;
  graph: DebateGraph | null;
  isOwner: boolean;
  exchange: DebateExchange | null;
}

export interface ViewerDerivation {
  /** Role on the canvas — `null` until an exchange exists and (for the challenger) is accepted. */
  viewerRole: "advocate" | "challenger" | null;
  /** Interactive viewer context (turn state); present only on an accepted exchange. */
  viewer: ViewerContext | null;
  /** Exchange id to submit turns against; present only on an accepted exchange. */
  viewerExchangeId: string | null;
}

// Translate "who is looking + the debate's open exchange" into the canvas viewer
// context. The advocate is always the owner; a non-owner is the challenger only on
// an accepted exchange. The interactive viewer (with turn state) likewise exists
// only once accepted — a pending invite is read-only, so it yields a null viewer.
export function deriveViewer({ user, graph, isOwner, exchange }: DeriveViewerArgs): ViewerDerivation {
  if (!graph || !user) return { viewerRole: null, viewer: null, viewerExchangeId: null };

  const isAccepted = exchange?.status === "accepted";
  const viewerRole: ViewerDerivation["viewerRole"] = isOwner
    ? "advocate"
    : isAccepted && exchange.challengerId === user.id
      ? "challenger"
      : null;

  if (!viewerRole || !isAccepted) {
    return { viewerRole, viewer: null, viewerExchangeId: null };
  }

  return {
    viewerRole,
    viewerExchangeId: exchange.id,
    viewer: {
      viewerId: user.id,
      viewerRole,
      advocateId: graph.debate.owner_id,
      isMyTurn: exchange.currentTurn === viewerRole,
    },
  };
}
