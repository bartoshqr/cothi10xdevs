import { useEffect, useState } from "react";
import type { TurnGateDetail } from "./MapEditor";

interface Props {
  viewerRole: "advocate" | "challenger";
  /** Server-initial turn state. Flips live on submit via the gate, for either party. */
  isMyTurn: boolean;
  currentRound: number;
  roundCount: number;
  /** The other party's username — advocate sees the challenger, and vice versa. */
  counterpartUsername: string | null;
  /** When true the exchange has closed — render a static "complete" state, no submit. */
  isCompleted?: boolean;
  /** When true the active turn is the challenger's closing mini-turn (marking only). */
  isMiniTurn?: boolean;
}

// Header bar shown to both parties during an active exchange, in one fixed order:
//   [turn label]  [submit button]  [round, counterpart @user]
// Both parties' buttons are functional and driven by the live turn gate that MapEditor
// pushes over `wvmap:turn-gate`: you must mark every one of the counterpart's statements
// before "Submit turn" enables. Once the exchange is completed the bar collapses to a
// static "Exchange complete" line. Mirrors the cross-island event pattern used elsewhere.
export default function TurnBar({
  viewerRole,
  isMyTurn,
  currentRound,
  roundCount,
  counterpartUsername,
  isCompleted = false,
  isMiniTurn = false,
}: Props) {
  const [gate, setGate] = useState<TurnGateDetail | null>(null);

  useEffect(() => {
    if (isCompleted) return;
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
  }, [isCompleted]);

  const counterpartRole = viewerRole === "challenger" ? "Advocate" : "Challenger";
  const counterpart = counterpartUsername ? `, ${counterpartRole} @${counterpartUsername}` : "";

  // Track the live gate once it arrives; fall back to the server-initial state. The gate
  // carries completion and mini-turn too, so the header reacts the instant a submit flips
  // the turn — including the actor's own seat (the advocate's final-round submit opening
  // the challenger's mini-turn, or the mini-turn submit completing the exchange).
  const myTurn = gate?.isMyTurn ?? isMyTurn;
  const miniTurn = gate?.isMiniTurn ?? isMiniTurn;
  const completed = gate?.isCompleted ?? isCompleted;
  const round = gate?.currentRound ?? currentRound;

  // Closed exchange: no live turn, no submit — just a static completion line.
  if (completed) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm font-medium">Exchange complete</span>
        <span className="text-muted-foreground text-sm">
          {round}/{roundCount} round{counterpart}
        </span>
      </div>
    );
  }

  // The mini-turn is always the challenger's closing, marking-only turn, so label it as
  // such for both seats: "My mini-turn" for the challenger, "Challenger's mini-turn" for
  // the advocate watching.
  const turnLabel = myTurn
    ? miniTurn
      ? "My mini-turn"
      : "My Turn"
    : viewerRole === "challenger"
      ? "Advocate's turn"
      : miniTurn
        ? "Challenger's mini-turn"
        : "Challenger's turn";

  const marked = gate?.markedCount ?? 0;
  const total = gate?.total ?? 0;
  const canSubmit = myTurn && marked === total;
  // Off-turn (you've submitted, or are waiting for the other party): a muted, disabled
  // "Submitted". On-turn: the live "Submit turn (marked/total)" gate.
  const buttonLabel = myTurn ? `Submit turn (${marked}/${total})` : "Submitted";
  const title = !myTurn
    ? "You've submitted your turn"
    : canSubmit
      ? "Submit your turn"
      : `Mark all counterpart statements first (${marked}/${total})`;

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
        {round}/{roundCount} round{counterpart}
      </span>
    </div>
  );
}
