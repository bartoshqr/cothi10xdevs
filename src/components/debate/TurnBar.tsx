import { useEffect, useState } from "react";
import type { TurnGateDetail } from "./MapEditor";

interface Props {
  viewerRole: "advocate" | "challenger";
  /** Server-initial turn state. The challenger's flips live on submit via the gate. */
  isMyTurn: boolean;
  currentRound: number;
  roundCount: number;
  /** The other party's username — advocate sees the challenger, and vice versa. */
  counterpartUsername: string | null;
}

// Header bar shown to both parties during an active exchange, in one fixed order:
//   [turn label]  [submit button]  [round, counterpart @user]
// The challenger's button is functional and driven by the live turn gate that MapEditor
// pushes over `wvmap:turn-gate` (it flips to a disabled "Submitted" after they submit). The
// advocate's button is a disabled placeholder for layout symmetry — advocate turn
// submission lands in S-04 — and their row is static (their turn doesn't flip within their
// own session). Mirrors the cross-island event pattern used elsewhere in the header.
export default function TurnBar({ viewerRole, isMyTurn, currentRound, roundCount, counterpartUsername }: Props) {
  const isChallenger = viewerRole === "challenger";
  const [gate, setGate] = useState<TurnGateDetail | null>(null);

  useEffect(() => {
    if (!isChallenger) return;
    function onGate(e: Event) {
      setGate((e as CustomEvent<TurnGateDetail>).detail);
    }
    window.addEventListener("wvmap:turn-gate", onGate);
    // Ask MapEditor to re-send the current gate so a slower hydration order can't leave
    // this stuck on the initial state.
    window.dispatchEvent(new CustomEvent("wvmap:request-turn-gate"));
    return () => {
      window.removeEventListener("wvmap:turn-gate", onGate);
    };
  }, [isChallenger]);

  // The challenger tracks the live gate once it arrives; the advocate stays on props.
  const myTurn = isChallenger ? (gate?.isMyTurn ?? isMyTurn) : isMyTurn;
  const turnLabel = myTurn ? "My Turn" : isChallenger ? "Advocate's turn" : "Challenger's turn";

  const marked = gate?.markedCount ?? 0;
  const total = gate?.total ?? 0;
  const canSubmit = isChallenger && myTurn && total > 0 && marked === total;
  const submitted = isChallenger && !myTurn;
  const buttonLabel = !isChallenger ? "Submit turn" : submitted ? "Submitted" : `Submit turn (${marked}/${total})`;
  const title = !isChallenger
    ? "Advocate turn submission comes in S-04"
    : submitted
      ? "You've submitted your turn"
      : canSubmit
        ? "Submit your turn"
        : `Mark all advocate statements first (${marked}/${total})`;

  const counterpartRole = isChallenger ? "Advocate" : "Challenger";
  const counterpart = counterpartUsername ? `, ${counterpartRole} @${counterpartUsername}` : "";

  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground text-sm font-medium">{turnLabel}</span>
      <button
        className="inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-semibold transition-colors"
        style={{
          backgroundColor: canSubmit ? "var(--primary)" : "var(--muted)",
          color: canSubmit ? "var(--primary-foreground)" : "var(--muted-foreground)",
          cursor: canSubmit ? "pointer" : "not-allowed",
          border: "1px solid var(--border)",
        }}
        disabled={!canSubmit}
        title={title}
        onClick={() => {
          window.dispatchEvent(new CustomEvent("wvmap:submit-turn"));
        }}
      >
        {buttonLabel}
      </button>
      <span className="text-muted-foreground text-sm">
        {currentRound}/{roundCount} round{counterpart}
      </span>
    </div>
  );
}
