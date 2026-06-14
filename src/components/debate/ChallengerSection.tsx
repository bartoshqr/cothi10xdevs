import { useEffect, useRef, useState } from "react";
import ChallengerInviteCard from "./ChallengerInviteCard";
import type { DebateListState } from "@/lib/debate/repository";
import { stateRank } from "@/lib/debate/displayState";

export interface ChallengerItem {
  exchange_id: string;
  debate_id: string;
  debate_title: string;
  root_claim_title: string | null;
  advocate_username: string | null;
  round_count: number | null;
  current_round: number | null;
  initial_status: "pending" | "accepted" | "completed";
}

interface AllDebatesResponse {
  debates: {
    id: string;
    title: string;
    root_claim_title: string | null;
    role: "advocate" | "challenger";
    state: DebateListState;
    exchange_id: string | null;
    other_username: string | null;
    round_count: number | null;
    current_round: number | null;
    created_at: string;
  }[];
}

function toItem(d: AllDebatesResponse["debates"][number] & { exchange_id: string }): ChallengerItem {
  const initial_status = d.state === "awaiting" ? "pending" : d.state === "in_progress" ? "accepted" : "completed";
  return {
    exchange_id: d.exchange_id,
    debate_id: d.id,
    debate_title: d.title,
    root_claim_title: d.root_claim_title,
    advocate_username: d.other_username,
    round_count: d.round_count,
    current_round: d.current_round,
    initial_status,
  };
}

function sortItems(items: ChallengerItem[], debates: AllDebatesResponse["debates"]): ChallengerItem[] {
  const createdAt = new Map(debates.map((d) => [d.exchange_id, d.created_at]));
  const stateMap = new Map(debates.map((d) => [d.exchange_id, d.state]));
  return [...items].sort((a, b) => {
    const ra = stateRank(stateMap.get(a.exchange_id) ?? "closed");
    const rb = stateRank(stateMap.get(b.exchange_id) ?? "closed");
    if (ra !== rb) return ra - rb;
    return (
      new Date(createdAt.get(b.exchange_id) ?? 0).getTime() - new Date(createdAt.get(a.exchange_id) ?? 0).getTime()
    );
  });
}

interface Props {
  initialItems: ChallengerItem[];
}

export default function ChallengerSection({ initialItems }: Props) {
  const [items, setItems] = useState<ChallengerItem[]>(initialItems);
  // Track dismissed exchange_ids so revived polls don't re-add declined cards.
  const dismissedIds = useRef(new Set<string>());

  useEffect(() => {
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function check() {
      try {
        const res = await fetch("/api/debates");
        if (!res.ok || stopped) return;
        const json = (await res.json()) as AllDebatesResponse;
        // Full-replace: update all fields on existing cards, add new ones, drop gone ones.
        // Dismissed cards (declined) stay filtered out via dismissedIds.
        const fresh = json.debates.filter(
          (d): d is typeof d & { exchange_id: string } =>
            d.role === "challenger" &&
            (d.state === "awaiting" || d.state === "in_progress" || d.state === "closed") &&
            d.exchange_id !== null &&
            !dismissedIds.current.has(d.exchange_id),
        );
        setItems(sortItems(fresh.map(toItem), json.debates));
      } catch {
        // transient — next tick retries
      }
    }

    function start() {
      intervalId ??= setInterval(() => void check(), 1000);
    }
    function stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
    function onVisibility() {
      if (document.hidden) {
        stop();
      } else {
        void check();
        start();
      }
    }

    if (!document.hidden) {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  function handleRemove(exchangeId: string) {
    dismissedIds.current.add(exchangeId);
    setItems((prev) => prev.filter((i) => i.exchange_id !== exchangeId));
  }

  if (items.length === 0) {
    return (
      <div className="border-border bg-card rounded-xl border p-8 text-center">
        <p className="text-muted-foreground text-sm">No debates where you&apos;re the challenger.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <ChallengerInviteCard
          key={item.exchange_id}
          exchangeId={item.exchange_id}
          debateId={item.debate_id}
          debateTitle={item.debate_title}
          rootClaimTitle={item.root_claim_title}
          advocateUsername={item.advocate_username}
          roundCount={item.round_count}
          currentRound={item.current_round}
          initialStatus={item.initial_status}
          onRemoved={() => {
            handleRemove(item.exchange_id);
          }}
        />
      ))}
    </ul>
  );
}
