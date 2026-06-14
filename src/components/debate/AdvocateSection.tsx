import { useEffect, useRef, useState } from "react";
import { stateBadge, stateRank } from "@/lib/debate/displayState";
import type { DebateListState } from "@/lib/debate/repository";

export interface AdvocateItem {
  id: string;
  title: string;
  root_claim_title: string | null;
  state: DebateListState;
  other_username: string | null;
  round_count: number | null;
  current_round: number | null;
  created_at: string;
}

interface AllDebatesResponse {
  debates: {
    id: string;
    title: string;
    root_claim_title: string | null;
    role: "advocate" | "challenger";
    state: DebateListState;
    other_username: string | null;
    round_count: number | null;
    current_round: number | null;
    created_at: string;
  }[];
}

interface Props {
  initialItems: AdvocateItem[];
}

function sortItems(items: AdvocateItem[]): AdvocateItem[] {
  return [...items].sort((a, b) => {
    const rankDiff = stateRank(a.state) - stateRank(b.state);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export default function AdvocateSection({ initialItems }: Props) {
  const [items, setItems] = useState<AdvocateItem[]>(() => sortItems(initialItems));
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Tracks debates deleted locally so a poll doesn't revive them before DB catches up.
  const deletedIds = useRef(new Set<string>());

  useEffect(() => {
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function check() {
      try {
        const res = await fetch("/api/debates");
        if (!res.ok || stopped) return;
        const json = (await res.json()) as AllDebatesResponse;
        const fresh = json.debates
          .filter((d) => d.role === "advocate" && !deletedIds.current.has(d.id))
          .map(
            (d): AdvocateItem => ({
              id: d.id,
              title: d.title,
              root_claim_title: d.root_claim_title,
              state: d.state,
              other_username: d.other_username,
              round_count: d.round_count,
              current_round: d.current_round,
              created_at: d.created_at,
            }),
          );
        setItems(sortItems(fresh));
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

  async function handleDelete(id: string) {
    setDeleting(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/debates/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setDeleteError(body.error ?? "Delete failed");
        return;
      }
      deletedIds.current.add(id);
      setItems((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setDeleteError("Network error");
    } finally {
      setDeleting(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="border-border bg-card rounded-xl border p-8 text-center">
        <p className="text-muted-foreground text-sm">You haven&apos;t started any debates yet.</p>
      </div>
    );
  }

  return (
    <>
      {deleteError && (
        <p className="text-destructive mb-3 text-sm" role="alert">
          {deleteError}
        </p>
      )}
      <ul className="space-y-4">
        {items.map((debate) => {
          const badge = stateBadge(debate.state, "advocate");
          return (
            <li key={debate.id} className="border-border bg-card rounded-xl border p-5">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-foreground truncate font-semibold">{debate.title}</p>
                  {debate.root_claim_title && (
                    <p className="text-muted-foreground mt-0.5 text-sm">Root claim: {debate.root_claim_title}</p>
                  )}
                  {debate.other_username && (
                    <p className="text-muted-foreground mt-0.5 text-sm">Challenger: @{debate.other_username}</p>
                  )}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.classes}`}>
                  {badge.label}
                </span>
              </div>

              {debate.round_count !== null && debate.current_round !== null && (
                <p className="text-muted-foreground mb-3 text-xs">
                  Round {debate.current_round}/{debate.round_count}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={`/debates/${debate.id}`}
                  className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                >
                  Open debate
                </a>
                {debate.state === "drafting" && (
                  <button
                    onClick={() => void handleDelete(debate.id)}
                    disabled={deleting === debate.id}
                    className="text-destructive text-sm font-medium underline-offset-4 hover:underline disabled:opacity-50"
                  >
                    {deleting === debate.id ? "Deleting…" : "Delete"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
