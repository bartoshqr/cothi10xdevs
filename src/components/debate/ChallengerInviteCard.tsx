import { useState } from "react";
import RespondInvite from "./RespondInvite";
import { stateBadge } from "@/lib/debate/displayState";
import type { DebateListState } from "@/lib/debate/repository";

interface Props {
  exchangeId: string;
  debateId: string;
  debateTitle: string;
  rootClaimTitle: string | null;
  advocateUsername: string | null;
  roundCount: number | null;
  currentRound: number | null;
  initialStatus: "pending" | "accepted";
  /** Called after the card is declined so the parent list can remove the entry. */
  onRemoved?: () => void;
}

function deriveState(status: "pending" | "accepted"): DebateListState {
  return status === "pending" ? "awaiting" : "in_progress";
}

export default function ChallengerInviteCard({
  exchangeId,
  debateId,
  debateTitle,
  rootClaimTitle,
  advocateUsername,
  roundCount,
  currentRound,
  initialStatus,
  onRemoved,
}: Props) {
  const [status, setStatus] = useState<"pending" | "accepted">(initialStatus);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function handleResolved(accepted: boolean) {
    if (accepted) {
      setStatus("accepted");
    } else {
      setDismissed(true);
      onRemoved?.();
    }
  }

  const badge = stateBadge(deriveState(status), "challenger");

  return (
    <li className="border-border bg-card rounded-xl border p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-foreground truncate font-semibold">{debateTitle}</p>
          {rootClaimTitle && <p className="text-muted-foreground mt-0.5 text-sm">Root claim: {rootClaimTitle}</p>}
          {advocateUsername && <p className="text-muted-foreground mt-0.5 text-sm">Advocate: @{advocateUsername}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.classes}`}>
          {badge.label}
        </span>
      </div>

      {roundCount !== null && currentRound !== null && (
        <p className="text-muted-foreground mb-3 text-xs">
          Round {currentRound}/{roundCount}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {status === "accepted" ? (
          <a
            href={`/debates/${debateId}`}
            className="text-primary text-sm font-medium underline-offset-4 hover:underline"
          >
            Enter debate
          </a>
        ) : (
          <>
            <a
              href={`/debates/${debateId}`}
              className="text-primary text-sm font-medium underline-offset-4 hover:underline"
            >
              View debate
            </a>
            <RespondInvite exchangeId={exchangeId} onResolved={handleResolved} />
          </>
        )}
      </div>
    </li>
  );
}
