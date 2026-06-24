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
  // Whether the "why can't I submit" popover is open (hover/focus of the submit button).
  const [showReasons, setShowReasons] = useState(false);

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
  const danglingCount = gate?.danglingCount ?? 0;
  const danglingTitles = gate?.danglingTitles ?? [];
  const incompleteConnectiveCount = gate?.incompleteConnectiveCount ?? 0;
  // Until the first gate arrives we don't know the mark counts yet. Treat that as
  // not-submittable: the null-gate fallback (marked=0,total=0) otherwise makes
  // `marked === total` momentarily true, flashing the button ENABLED on a fresh
  // turn for one frame before the real 0/N gate lands. Holding it disabled until
  // `hasGate` removes that flicker (the gate handshake answers on mount, so the
  // real state arrives a tick later).
  const hasGate = gate !== null;
  // Three live gates block a submit: every counterpart statement marked, no own statement
  // orphaned (severed from root), and no own AND/OR connective missing an operand. The two
  // structural gates are suppressed upstream in the mini-turn.
  const canSubmit = hasGate && myTurn && marked === total && danglingCount === 0 && incompleteConnectiveCount === 0;
  // Off-turn (you've submitted, or are waiting for the other party): a muted, disabled
  // "Submitted". On-turn: the live "Submit turn (marked/total)" gate — but suppress the
  // count until the gate lands so we never show a stale "0/0".
  const buttonLabel = myTurn ? (hasGate ? `Submit turn (${marked}/${total})` : "Submit turn") : "Submitted";

  // Every reason the submit is blocked, as one list rendered in a single popover (the only
  // place blocking reasons are shown — no native tooltip, no inline text). Structural problems
  // lead because they must be fixed before the mark count even matters.
  const blockingReasons: string[] = [];
  if (myTurn && !canSubmit) {
    if (danglingCount > 0) {
      blockingReasons.push(
        `Reconnect or delete your orphaned statement${danglingCount > 1 ? "s" : ""}: ${danglingTitles.join(", ")}.`,
      );
    }
    if (incompleteConnectiveCount > 0) {
      blockingReasons.push("Give every AND/OR group at least two operands.");
    }
    if (marked < total) {
      blockingReasons.push(`Mark all counterpart statements (${marked}/${total})`);
    }
  }
  const reasonsOpen = showReasons && blockingReasons.length > 0;

  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground text-sm font-medium">{turnLabel}</span>
      <span
        className="relative inline-flex"
        onMouseEnter={() => {
          setShowReasons(true);
        }}
        onMouseLeave={() => {
          setShowReasons(false);
        }}
      >
        <button
          className="inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-semibold transition-colors"
          style={{
            backgroundColor: canSubmit ? "var(--primary)" : "var(--muted)",
            color: canSubmit ? "var(--primary-foreground)" : "var(--muted-foreground)",
            cursor: canSubmit ? "pointer" : "not-allowed",
            border: "1px solid var(--border)",
            // Let the wrapper receive hover when disabled so the popover still opens.
            pointerEvents: canSubmit ? "auto" : "none",
          }}
          disabled={!canSubmit}
          onClick={() => {
            window.dispatchEvent(new CustomEvent("wvmap:submit-turn"));
          }}
        >
          {buttonLabel}
        </button>

        {reasonsOpen && (
          <div
            className="bg-background absolute top-full left-1/2 z-50 mt-2 w-72 -translate-x-1/2 rounded-lg border p-3 text-left shadow-lg"
            style={{ borderColor: "var(--border)" }}
            role="tooltip"
          >
            <p className="text-foreground mb-1.5 text-xs font-semibold">Can’t submit your turn yet</p>
            <ul className="space-y-1">
              {blockingReasons.map((reason) => (
                <li key={reason} className="text-muted-foreground flex gap-1.5 text-xs">
                  <span className="text-destructive leading-4">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </span>
      <span className="text-muted-foreground text-sm">
        {round}/{roundCount} round{counterpart}
      </span>
    </div>
  );
}
