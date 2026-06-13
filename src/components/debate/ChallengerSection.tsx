import { useEffect, useRef, useState } from "react";
import ChallengerInviteCard from "./ChallengerInviteCard";

export interface ChallengerItem {
  exchange_id: string;
  debate_id: string;
  debate_title: string;
  root_claim_title: string | null;
  advocate_username: string | null;
  round_count: number | null;
  current_round: number | null;
  initial_status: "pending" | "accepted";
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
        const res = await fetch("/api/exchanges");
        if (!res.ok || stopped) return;
        const json = (await res.json()) as { items: ChallengerItem[] };
        setItems((prev) => {
          const knownIds = new Set(prev.map((i) => i.exchange_id));
          const newItems = json.items.filter(
            (i) => !knownIds.has(i.exchange_id) && !dismissedIds.current.has(i.exchange_id),
          );
          return newItems.length > 0 ? [...prev, ...newItems] : prev;
        });
      } catch {
        // transient — next tick retries
      }
    }

    function start() {
      intervalId ??= setInterval(() => void check(), 15000);
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
