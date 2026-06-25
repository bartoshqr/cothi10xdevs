import { useEffect, useRef, useState } from "react";
import type { DivergenceSummary, SummaryItem } from "@/lib/summary/classify";
import type { TurnGateDetail } from "./MapEditor";
import { roleDescriptors } from "./mapVisualLanguage";
import { apiGetSummary } from "./persistence";

interface Props {
  debateId: string;
  /** The debate owner's user id — used with viewerId to derive role without relying on exchange state. */
  ownerId: string;
  /** The viewer's user id — splits each bucket into "my" vs "counterpart" statements. */
  viewerId?: string;
  /** Server-initial completion flag — overridden live by the turn gate. */
  isCompleted?: boolean;
  /** Server-initial round number — overridden live by the turn gate. */
  currentRound?: number;
  /** Server-fetched summary for the public showcase page (S-09). When provided, the panel
   * skips the authed fetch entirely — `/api/debates/[id]/summary` is `withAuth` and would
   * 401 for an anon visitor. The trigger button then only toggles visibility, never calls
   * `load()`. Starts closed like the authed page; the visitor still clicks to view it. */
  initialSummary?: DivergenceSummary | null;
  /** Advocate/challenger usernames — used to label statement groups by literal role
   * ("Advocate (@name)") when there's no logged-in `viewerId` (the anon showcase page). */
  advocateUsername?: string | null;
  challengerUsername?: string | null;
}

// A small badge carrying the statement's Toulmin role (CLAIM, DATA, …), reusing the
// canvas colour language so the summary reads consistently with the board.
function TypeBadge({ statementType }: { statementType: SummaryItem["statementType"] }) {
  const { accent, badge } = roleDescriptors[statementType];
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
      style={{ color: accent, border: `1px solid ${accent}` }}
    >
      {badge}
    </span>
  );
}

// Order within an author group: by statement kind alphabetically, then title alphabetically.
const byKindThenTitle = (a: SummaryItem, b: SummaryItem) =>
  a.statementType.localeCompare(b.statementType) || a.title.localeCompare(b.title);

// One shared two-column grid for every row in the panel: a fixed-width badge column whose
// contents are right-aligned (so all badges end at the same x) and a flexible title column
// (so all titles start at the same x). `Row` is used everywhere, so the alignment is
// consistent across the whole summary.
function Row({ item }: { item: SummaryItem }) {
  return (
    <li className="grid grid-cols-[4.5rem_1fr] items-baseline gap-2">
      {/* Kind badge, with the orphaned tag stacked directly beneath it (both right-aligned so
          they share the badge column's right edge). An orphaned statement keeps its stance
          bucket — the tag just flags that it no longer connects to the root claim. */}
      <span className="flex flex-col items-end gap-1 justify-self-end">
        <TypeBadge statementType={item.statementType} />
        {item.isOrphaned && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
            style={{ color: "#d97706", border: "1px solid #d97706" }}
          >
            ORPHANED
          </span>
        )}
      </span>
      <p className="text-foreground text-sm">{item.title}</p>
    </li>
  );
}

function AuthorGroup({ heading, items }: { heading: string; items: SummaryItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2 last:mb-0">
      <h5 className="text-muted-foreground/80 mb-1 text-[11px] font-medium">{heading}</h5>
      <ul className="space-y-1.5">
        {[...items].sort(byKindThenTitle).map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

// Split a bucket into the viewer's own statements and the counterpart's, each its own
// subgroup. Empty subgroups render nothing; an empty bucket renders the `empty` line.
//
// Without a `viewerId` (the anon showcase page — no logged-in viewer to be "me") there's no
// "my statements" to split out, so fall back to literal role labels ("Advocate"/"Challenger",
// derived from `ownerId` — the debate owner is always the advocate) instead of hiding who
// wrote what behind a generic "Counterpart" label.
function AuthorGroups({
  items,
  viewerId,
  ownerId,
  advocateLabel,
  challengerLabel,
  empty,
}: {
  items: SummaryItem[];
  viewerId?: string;
  ownerId: string;
  advocateLabel: string;
  challengerLabel: string;
  empty: string;
}) {
  if (items.length === 0) return <p className="text-muted-foreground text-xs italic">{empty}</p>;
  if (viewerId) {
    const mine = items.filter((i) => i.authorId === viewerId);
    const theirs = items.filter((i) => i.authorId !== viewerId);
    const counterpartLabel = viewerId === ownerId ? challengerLabel : advocateLabel;
    return (
      <>
        <AuthorGroup heading="My statements" items={mine} />
        <AuthorGroup heading={`${counterpartLabel} statements`} items={theirs} />
      </>
    );
  }
  const advocateItems = items.filter((i) => i.authorId === ownerId);
  const challengerItems = items.filter((i) => i.authorId !== ownerId);
  return (
    <>
      <AuthorGroup heading={advocateLabel} items={advocateItems} />
      <AuthorGroup heading={challengerLabel} items={challengerItems} />
    </>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h3 className="text-foreground text-sm font-semibold">{title}</h3>
      <span className="text-muted-foreground text-xs">{subtitle}</span>
    </div>
  );
}

// Read-only divergence summary. The trigger button appears once the round gate is met;
// clicking fetches `/api/debates/[id]/summary` on demand and renders the three buckets.
// No writes — purely a derived view of where the pair agrees, diverges, or hasn't resolved.
export default function DivergenceSummary({
  debateId,
  ownerId,
  viewerId,
  isCompleted = false,
  currentRound = 1,
  initialSummary,
  advocateUsername,
  challengerUsername,
}: Props) {
  // S-09: the showcase page passes a server-fetched summary; the panel then never hits
  // `/api/debates/[id]/summary` (which is `withAuth` → 401 for anon).
  const isStatic = initialSummary !== undefined;
  const [gate, setGate] = useState<TurnGateDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<DivergenceSummary | null>(initialSummary ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Subscribe to the same live turn gate MapEditor broadcasts to TurnBar, so the button
  // appears the instant a round closes for the counterpart (whose SSR props are stale —
  // their page was rendered before the advocate advanced the round). Request a re-send on
  // mount to survive a slow hydration order. Mirrors TurnBar's effect exactly.
  //
  // Skipped entirely in static (showcase) mode: MapEditor is mounted there too (frozen,
  // `viewer={null}`), and it still broadcasts a neutral `{isCompleted:false,currentRound:1}`
  // gate on mount — which would stomp the correct server-passed `isCompleted`/`currentRound`
  // props and hide the button. The anon page has no real live turn gate to track anyway.
  useEffect(() => {
    if (isStatic) return;
    function onGate(e: Event) {
      setGate((e as CustomEvent<TurnGateDetail>).detail);
    }
    window.addEventListener("wvmap:turn-gate", onGate);
    window.dispatchEvent(new CustomEvent("wvmap:request-turn-gate"));
    return () => {
      window.removeEventListener("wvmap:turn-gate", onGate);
    };
  }, [isStatic]);

  // Close the panel on a click anywhere outside it and its trigger button. Only listens
  // while open, so it's a no-op the rest of the time. Listen in the *capture* phase
  // (the `true` flag): React Flow's canvas calls stopPropagation on mousedown to start its
  // drag-to-pan gesture, so a bubble-phase listener would never see those clicks. Capture
  // runs document→target first, before React Flow can swallow the event.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [open]);

  // Round gate: a round has fully closed. `completed` covers a finished round_count=1
  // exchange; `round >= 2` covers a multi-round exchange whose first round closed.
  const completed = gate?.isCompleted ?? isCompleted;
  const round = gate?.currentRound ?? currentRound;
  const gateMet = completed || round >= 2;

  if (!gateMet) return null;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSummary(await apiGetSummary(debateId));
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }

  // Labels for AuthorGroups' role-based fallback (no viewerId — the anon showcase page).
  const advocateLabel = advocateUsername ? `Advocate (@${advocateUsername})` : "Advocate";
  const challengerLabel = challengerUsername ? `Challenger (@${challengerUsername})` : "Challenger";

  // Open divergences split by gap (factual before premise). The gap shows once as a
  // subsection heading; each gap then splits by author.
  const factualGaps = summary?.openDivergences.filter((i) => i.gap === "factual") ?? [];
  const premiseGaps = summary?.openDivergences.filter((i) => i.gap === "values") ?? [];

  return (
    <>
      <button
        ref={buttonRef}
        className="inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-semibold transition-colors"
        style={{
          backgroundColor: "var(--primary)",
          color: "var(--primary-foreground)",
          border: "1px solid var(--border)",
          cursor: loading ? "wait" : "pointer",
        }}
        disabled={loading}
        onClick={() => {
          if (isStatic) {
            setOpen((o) => !o);
            return;
          }
          if (open) {
            setOpen(false);
          } else {
            void load();
          }
        }}
      >
        {/* Stack every possible label in one grid cell so the button width locks to the
            widest one and the live label stays centered — no resizing as it changes. */}
        <span className="grid">
          <span className="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden="true">
            Hide divergence summary
          </span>
          <span className="col-start-1 row-start-1 text-center whitespace-nowrap">
            {loading ? "Loading…" : open ? "Hide divergence summary" : "View divergence summary"}
          </span>
        </span>
      </button>

      {error && <span className="text-destructive text-sm">{error}</span>}

      {open && summary && (
        <div
          ref={panelRef}
          className="bg-background absolute top-16 left-1/2 z-50 max-h-[70vh] w-100 -translate-x-1/2 overflow-y-auto rounded-lg border p-4 shadow-lg"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-foreground mb-3 text-base font-bold">Divergence summary</h2>

          <section className="mb-4">
            <SectionHeading title="Common ground" subtitle="Counterpart accepted" />
            <AuthorGroups
              items={summary.commonGround}
              viewerId={viewerId}
              ownerId={ownerId}
              advocateLabel={advocateLabel}
              challengerLabel={challengerLabel}
              empty="No accepted statements yet."
            />
          </section>

          <section className="mb-4">
            <SectionHeading title="Open divergences" subtitle="Counterpart challenged" />
            {factualGaps.length === 0 && premiseGaps.length === 0 ? (
              <p className="text-muted-foreground text-xs italic">No challenged statements.</p>
            ) : (
              <div className="space-y-3">
                {factualGaps.length > 0 && (
                  <div>
                    <h4 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                      Factual gaps
                    </h4>
                    <AuthorGroups
                      items={factualGaps}
                      viewerId={viewerId}
                      ownerId={ownerId}
                      advocateLabel={advocateLabel}
                      challengerLabel={challengerLabel}
                      empty=""
                    />
                  </div>
                )}
                {premiseGaps.length > 0 && (
                  <div>
                    <h4 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                      Premise gaps
                    </h4>
                    <AuthorGroups
                      items={premiseGaps}
                      viewerId={viewerId}
                      ownerId={ownerId}
                      advocateLabel={advocateLabel}
                      challengerLabel={challengerLabel}
                      empty=""
                    />
                  </div>
                )}
              </div>
            )}
          </section>

          <section>
            <SectionHeading title="Unresolved positions" subtitle="Abstained or unmarked" />
            <AuthorGroups
              items={summary.unresolved}
              viewerId={viewerId}
              ownerId={ownerId}
              advocateLabel={advocateLabel}
              challengerLabel={challengerLabel}
              empty="Nothing unresolved."
            />
          </section>
        </div>
      )}
    </>
  );
}
