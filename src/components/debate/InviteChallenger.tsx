import { useState, useEffect, useRef, useCallback } from "react";
import { ROUND_COUNT } from "@/lib/exchange/constants";
import { Button } from "@/components/ui/button";

interface UserResult {
  id: string;
  username: string;
}

interface ExistingExchange {
  id: string;
  status: "pending" | "accepted";
  challengerUsername: string | null;
  roundCount: number;
}

interface Props {
  debateId: string;
  hasRoot: boolean;
  isWellFormed: boolean;
  existingExchange: ExistingExchange | null;
}

// Tell the MapEditor island (separate hydration root) to lock/unlock the canvas
// without a reload. MapEditorInner listens for this on `window`. Module-scoped so
// it's a stable reference (safe inside effect deps).
function signalCanEdit(canEdit: boolean) {
  window.dispatchEvent(new CustomEvent("wvmap:set-can-edit", { detail: { canEdit } }));
}

export default function InviteChallenger({ debateId, existingExchange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserResult[]>([]);
  const [selected, setSelected] = useState<UserResult | null>(null);
  const [roundCount, setRoundCount] = useState<number>(ROUND_COUNT.default);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live exchange state, seeded from SSR. Updated in place on send/revoke/accept so
  // the status line changes without a page reload (the editor lock is flipped via
  // the cross-island event below).
  const [activeExchange, setActiveExchange] = useState<ExistingExchange | null>(existingExchange);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the panel on any click outside it — including the canvas. A backdrop
  // overlay won't work here: the header's `backdrop-blur` is a containing block,
  // so a `position:fixed` overlay only covers the header strip, not the page.
  // Capture-phase pointerdown fires before React Flow can stop propagation.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  const fetchUsers = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/users/search?username=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const json = (await res.json()) as { users: UserResult[] };
      setUsers(json.users);
    } catch {
      // network error — leave list as-is
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced search — only fires once the advocate has typed something. An empty
  // query shows a hint instead of listing everyone, so opening the panel never
  // flashes an empty-then-full list and never hits the network on its own.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length === 0) return;
    debounceRef.current = setTimeout(() => {
      void fetchUsers(query);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, fetchUsers]);

  // Freshness poll: while the invite is pending, watch for the challenger's
  // accept/decline so the advocate isn't stuck on a stale "awaiting response".
  // Gated on tab visibility — a backgrounded tab goes quiet (no ~3600 req/hour);
  // focus/visibility return triggers an immediate check.
  const activeId = activeExchange?.id;
  const activeStatus = activeExchange?.status;
  useEffect(() => {
    if (activeStatus !== "pending" || !activeId) return;
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function check() {
      try {
        const res = await fetch(`/api/exchanges/${activeId}`);
        if (!res.ok) return;
        const json = (await res.json()) as { status: string };
        if (stopped || json.status === "pending") return;
        if (json.status === "accepted") {
          // Advocate stays locked (an accepted exchange still freezes edits) —
          // just update the status line.
          setActiveExchange((prev) => (prev ? { ...prev, status: "accepted" } : prev));
        } else {
          // Declined: the exchange is closed → editing re-opens and the advocate
          // can re-invite. Clear the line and unlock the canvas.
          setActiveExchange(null);
          signalCanEdit(true);
        }
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
      void check();
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
  }, [activeStatus, activeId]);

  async function handleSend() {
    if (!selected) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/exchanges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debateId, challengerId: selected.id, roundCount }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(typeof json.error === "string" ? json.error : "Something went wrong.");
        return;
      }
      const json = (await res.json()) as { id: string };
      // Reflect the pending invite + freeze the canvas in place (no reload). The
      // challenger username + rounds are known from the selection, so the status
      // line is correct immediately.
      setActiveExchange({ id: json.id, status: "pending", challengerUsername: selected.username, roundCount });
      signalCanEdit(false);
      setOpen(false);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleRevoke() {
    if (!activeExchange) return;
    setRevoking(true);
    setError(null);
    try {
      const res = await fetch(`/api/exchanges/${activeExchange.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(typeof json.error === "string" ? json.error : "Couldn't revoke the invite.");
        return;
      }
      // Clear the status line + re-open editing in place (no reload).
      setActiveExchange(null);
      signalCanEdit(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setRevoking(false);
    }
  }

  if (activeExchange) {
    const who = activeExchange.challengerUsername ? `@${activeExchange.challengerUsername}` : "the challenger";
    return (
      <div className="flex items-center gap-2">
        {activeExchange.status === "pending" ? (
          <>
            <span className="text-muted-foreground text-sm">
              Invite sent to {who} for {activeExchange.roundCount} rounds — awaiting response
            </span>
            <Button type="button" variant="outline" size="sm" disabled={revoking} onClick={() => void handleRevoke()}>
              {revoking ? "Revoking…" : "Revoke"}
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">
            {who} accepted · {activeExchange.roundCount} rounds
          </span>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          if (!open) {
            setQuery("");
            setSelected(null);
            setError(null);
            setUsers([]);
          }
          setOpen((v) => !v);
        }}
      >
        Invite challenger
      </Button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 w-80 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--card-foreground)]">Invite challenger</h3>
          </div>

          <div className="space-y-4 px-4 py-3">
            {/* Username search */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">Username</label>
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  const val = e.target.value;
                  setQuery(val);
                  setSelected(null);
                  // Clearing the box returns to the hint state — drop stale matches.
                  if (val.trim().length === 0) setUsers([]);
                }}
                placeholder="Search users…"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:ring-1 focus:ring-[var(--ring)] focus:outline-none"
              />
              {!selected && users.length > 0 && (
                <ul className="mt-1 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)]">
                  {users.map((u) => (
                    <li key={u.id}>
                      <button
                        className="w-full px-3 py-1.5 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                        onClick={() => {
                          setSelected(u);
                          setQuery(u.username);
                        }}
                      >
                        {u.username}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!selected && users.length === 0 && (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {query.trim().length === 0
                    ? "Type a username to search."
                    : searching
                      ? "Searching…"
                      : "No users found."}
                </p>
              )}
              {selected && (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Selected:{" "}
                  <button
                    className="underline"
                    onClick={() => {
                      setSelected(null);
                      setQuery("");
                    }}
                  >
                    {selected.username}
                  </button>{" "}
                  (click to change)
                </p>
              )}
            </div>

            {/* Round count */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--muted-foreground)]">
                Rounds ({ROUND_COUNT.min}–{ROUND_COUNT.max})
              </label>
              <div className="flex gap-1">
                {Array.from({ length: ROUND_COUNT.max - ROUND_COUNT.min + 1 }, (_, i) => i + ROUND_COUNT.min).map(
                  (n) => (
                    <button
                      key={n}
                      onClick={() => {
                        setRoundCount(n);
                      }}
                      className={`flex h-8 w-8 items-center justify-center rounded text-sm font-medium transition-colors ${
                        roundCount === n
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)]"
                      }`}
                    >
                      {n}
                    </button>
                  ),
                )}
              </div>
            </div>

            {/* Error message — surfaces server 422/409 via the message text */}
            {error && <p className="text-xs text-red-500">{error}</p>}

            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!selected || sending}
              onClick={() => void handleSend()}
            >
              {sending ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
