import { Handle, Position, useConnection } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useRef, useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  roleDescriptors,
  markStanceDescriptors,
  CHALLENGER_TINT,
  CHALLENGER_BORDER,
  MENU_VIEWPORT_MARGIN,
} from "../mapVisualLanguage";
import type { StatementRole, MarkStance } from "../mapVisualLanguage";
import { useStore, useShallow } from "../store";
import { NODE_CONSTRAINTS, isValidUrl } from "@/lib/debate/nodeConstraints";
import { MARK_STANCES } from "@/lib/mark/constants";

export interface StatementNodeData extends Record<string, unknown> {
  role?: StatementRole;
  title: string;
  body: string;
  url?: string;
  isRoot?: boolean;
  pending?: boolean;
  /** DB author_id — kept on node data to derive author role at render time. */
  authorId?: string;
}

export type StatementNodeType = Node<StatementNodeData, "statement">;

const STATEMENT_ROLES: StatementRole[] = ["claim", "data", "source", "warrant", "backing", "rebuttal"];

export default function StatementNode({ id, data }: NodeProps<StatementNodeType>) {
  const { inProgress, toNode } = useConnection();
  const isActiveTarget = inProgress && toNode?.id === id;
  const {
    inEditNodeId,
    setInEditNode,
    updateNodeFields,
    setRootNode,
    deleteNodes,
    tryExitNodeEdit,
    canEditNode,
    canMarkNode,
    marks,
    setMark,
    viewer,
    isOrphanedOwn,
  } = useStore(
    useShallow((s) => ({
      inEditNodeId: s.inEditNodeId,
      setInEditNode: s.setInEditNode,
      updateNodeFields: s.updateNodeFields,
      setRootNode: s.setRootNode,
      deleteNodes: s.deleteNodes,
      tryExitNodeEdit: s.tryExitNodeEdit,
      canEditNode: s.canEditNode,
      canMarkNode: s.canMarkNode,
      marks: s.marks,
      setMark: s.setMark,
      viewer: s.viewer,
      // This node is one of the viewer's own statements that no longer reaches root.
      isOrphanedOwn: s.orphanedOwnNodeIds().includes(id),
    })),
  );

  const isEditing = inEditNodeId === id;
  const canEditThisNode = canEditNode(id);
  const canMarkThisNode = canMarkNode(id);
  const markEntry = marks[id];
  const currentMark: MarkStance | undefined = markEntry?.stance;
  // valid=false: content changed since mark was placed — counterpart must re-evaluate before submitting.
  const isStale = markEntry !== undefined && !markEntry.valid;
  // Show the mark bar when the viewer can mark this node now, OR a mark already exists on
  // it. The latter keeps a mark visible read-only after the challenger submits, and also
  // surfaces the challenger's mark to the advocate on the advocate's own statement once the
  // turn flips. In round 1 only one party marks, so any present mark is unambiguous; the
  // bar is interactive only while `canMarkThisNode`.
  const showMarkBar = canMarkThisNode || currentMark !== undefined;
  // Flag an orphaned own statement only while it's the viewer's turn, so they know what to
  // delete or reconnect before submitting (the submit-gate is the hard block). Pre-exchange
  // mid-build nodes aren't flagged — the advocate's invite guard handles that case instead.
  // Suppressed while the node is open for editing: a freshly-added node is trivially orphaned
  // until wired up, so don't flash the warning mid-creation (the submit-gate still catches it).
  const showOrphanWarning = isOrphanedOwn && (viewer?.isMyTurn ?? false) && !isEditing;
  const isChallenger = data.authorId !== undefined && viewer !== null && data.authorId !== viewer.advocateId;
  // Card chrome (outer border + section dividers) uses a warm rosy line on the challenger's
  // tinted card so a cold neutral gray doesn't read muddy over the tint; advocate cards keep gray.
  const cardBorder = isChallenger ? CHALLENGER_BORDER : "var(--border)";
  const role = data.isRoot ? "claim" : (data.role ?? "claim");
  const descriptor = roleDescriptors[role];
  const badge = data.isRoot ? "ROOT" : descriptor.badge;

  // Local state keeps cursor stable — store is write-through only.
  const [localTitle, setLocalTitle] = useState(data.title);
  const [localBody, setLocalBody] = useState(data.body);
  const [localUrl, setLocalUrl] = useState(data.url ?? "");

  // Refs to read latest values without adding them to effect deps.
  const dataRef = useRef(data);
  dataRef.current = data;
  const prevRoleRef = useRef(role);

  // Snapshot of data at the moment edit mode opens — used to revert on Escape.
  const originalDataRef = useRef({ title: data.title, body: data.body, url: data.url, role: data.role });

  // `y` = open-downward anchor (below the badge); `flipTop` = open-upward anchor (above the badge).
  const [badgeAnchor, setBadgeAnchor] = useState<{ x: number; y: number; flipTop: number } | null>(null);
  const [badgeFlipped, setBadgeFlipped] = useState(false);
  const badgeMenuRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  // Sync local state from store and focus title when entering edit mode.
  useEffect(() => {
    if (isEditing) {
      const d = dataRef.current;
      originalDataRef.current = { title: d.title, body: d.body, url: d.url, role: d.role };
      setLocalTitle(d.title);
      setLocalBody(d.body);
      setLocalUrl(d.url ?? "");
      if (titleRef.current) {
        const el = titleRef.current;
        resizeEl(el);
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    }
  }, [isEditing]);

  // When the role switches to "source" mid-edit, sync the URL field from the store.
  useEffect(() => {
    if (isEditing && role === "source" && prevRoleRef.current !== "source") {
      setLocalUrl(dataRef.current.url ?? "");
    }
    prevRoleRef.current = role;
  }, [isEditing, role]);

  function handleNodeDoubleClick(e: React.MouseEvent) {
    if (!canEditThisNode) return;
    e.stopPropagation();
    setInEditNode(id);
  }

  function resizeEl(el: HTMLElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleRevertAndExit() {
    const orig = originalDataRef.current;
    updateNodeFields(id, { title: orig.title, body: orig.body, url: orig.url, statementType: orig.role });
    setLocalTitle(orig.title);
    setLocalBody(orig.body);
    setLocalUrl(orig.url ?? "");
    setInEditNode(null);
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (role === "source") {
        urlRef.current?.focus();
      } else {
        bodyRef.current?.focus();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      tryExitNodeEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleRevertAndExit();
    }
  }

  function handleBodyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      tryExitNodeEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleRevertAndExit();
    }
  }

  function handleUrlKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && localUrl && isValidUrl(localUrl)) {
      e.preventDefault();
      bodyRef.current?.focus();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      tryExitNodeEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleRevertAndExit();
    }
  }

  function handleBadgeClick(e: React.MouseEvent) {
    if (!canEditThisNode || data.isRoot) return;
    e.stopPropagation();
    const rect = badgeRef.current?.getBoundingClientRect();
    if (rect) setBadgeAnchor({ x: rect.left, y: rect.bottom + 4, flipTop: rect.top - 4 });
  }

  // Flip the role dropdown upward when it would overflow the bottom of the viewport
  // (same transform trick as AddNodeMenu / NodeContextMenu). Runs before paint so
  // there is no downward flash before the correction.
  useLayoutEffect(() => {
    if (badgeAnchor && badgeMenuRef.current) {
      setBadgeFlipped(badgeAnchor.y + badgeMenuRef.current.offsetHeight + MENU_VIEWPORT_MARGIN > window.innerHeight);
    }
  }, [badgeAnchor]);

  const badgeDropdown =
    badgeAnchor !== null
      ? createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => {
                setBadgeAnchor(null);
              }}
            />
            <div
              ref={badgeMenuRef}
              className="fixed z-50 overflow-hidden rounded-lg shadow-lg"
              style={{
                left: badgeAnchor.x,
                top: badgeFlipped ? badgeAnchor.flipTop : badgeAnchor.y,
                transform: badgeFlipped ? "translateY(-100%)" : undefined,
                minWidth: 150,
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--card-foreground)",
              }}
            >
              <div
                className="px-3 py-1 text-[10px] font-bold tracking-wider uppercase"
                style={{ color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}
              >
                Role
              </div>
              {STATEMENT_ROLES.map((r) => {
                const d = roleDescriptors[r];
                const displayBadge = d.badge ?? r.toUpperCase();
                return (
                  <button
                    key={r}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--muted)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateNodeFields(id, { statementType: r });
                      if (r === "source") setInEditNode(id);
                      setBadgeAnchor(null);
                    }}
                  >
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase"
                      style={{ backgroundColor: d.accent, opacity: 1 }}
                    >
                      {displayBadge}
                    </span>
                  </button>
                );
              })}
              {/* The root claim is frozen once an exchange is open — the debate's central
                  claim can't be re-designated mid-exchange. UI-only gate for now (no RLS);
                  the store backstops it. */}
              {viewer === null && (
                <>
                  <div style={{ borderTop: "1px solid var(--border)" }} />
                  <button
                    className="flex w-full items-center px-3 py-1.5 text-left text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
                    style={{ color: "var(--primary)" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Single persisted, atomic re-designation (D3-3c): the store awaits
                      // the server, then applies role→claim, isRoot, and edge-strip on success.
                      void setRootNode(id);
                      setBadgeAnchor(null);
                    }}
                  >
                    Set as Root Claim
                  </button>
                </>
              )}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <>
      {/* Keep the source Handle mounted whenever the node is real (not pending) and
          toggle it via `isConnectable` + CSS rather than conditional rendering. React
          Flow caches per-node `handleBounds` on Handle *mount*; since a node's id is
          stable across root re-designation, unmounting on `isRoot` left a stale
          "no source handle" record, so a former root's handle was dead on re-add.
          Always-mounting keeps the registration intact. (Pending nodes still gate
          out — their id swaps on reconcile, giving a fresh clean internals record.) */}
      {!data.pending && (
        <Handle
          type="source"
          position={Position.Top}
          isConnectable={!data.isRoot}
          style={{
            background: descriptor.accent,
            border: "2px solid white",
            width: 12,
            height: 12,
            boxShadow: `0 0 0 2px ${descriptor.accent}44`,
            opacity: data.isRoot ? 0 : 1,
            pointerEvents: data.isRoot ? "none" : "auto",
          }}
        />
      )}
      <div
        className="relative flex max-w-[300px] min-w-[210px] overflow-hidden rounded-lg shadow-sm"
        style={{
          border: `1px solid ${isEditing ? descriptor.accent : isActiveTarget ? "var(--primary)" : cardBorder}`,
          boxShadow: isActiveTarget ? "0 0 0 3px color-mix(in srgb, var(--primary) 30%, transparent)" : undefined,
          backgroundColor: isChallenger ? CHALLENGER_TINT : "var(--card)",
          color: "var(--card-foreground)",
          opacity: data.pending ? 0.6 : 1,
        }}
        onDoubleClick={handleNodeDoubleClick}
      >
        {/* D3-3a: the root claim has no delete affordance — re-designate via the
            badge menu's "Set as Root Claim" instead. Other delete paths (keyboard,
            context menu) are blocked in the store, and the server backstops with a 409. */}
        {isEditing && !data.isRoot && canEditThisNode && (
          <button
            className="nodrag nopan absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded text-xs leading-none transition-colors hover:bg-[var(--muted)]"
            style={{ color: "var(--muted-foreground)" }}
            onClick={(e) => {
              e.stopPropagation();
              deleteNodes([id]);
            }}
          >
            ×
          </button>
        )}
        <div className="w-1 shrink-0" style={{ backgroundColor: descriptor.accent }} />
        <div className="min-w-0 flex-1">
          {/* Header: badge + title */}
          <div className={`border-b py-1.5 pl-3 ${isEditing ? "pr-6" : "pr-3"}`} style={{ borderColor: cardBorder }}>
            <div className="flex items-center gap-2">
              {badge && (
                <span
                  ref={badgeRef}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wider text-white uppercase select-none ${
                    canEditThisNode && !data.isRoot ? "cursor-pointer" : ""
                  }`}
                  style={{ backgroundColor: descriptor.accent }}
                  title={canEditThisNode && !data.isRoot ? "Click to change role" : undefined}
                  onClick={handleBadgeClick}
                >
                  {badge}
                </span>
              )}
              {isEditing ? (
                <textarea
                  ref={titleRef}
                  rows={1}
                  className="nodrag nopan min-w-0 flex-1 resize-none overflow-hidden rounded border px-1.5 py-0.5 text-sm font-semibold outline-none"
                  style={{
                    borderColor: !localTitle ? "var(--destructive)" : "var(--border)",
                    backgroundColor: "var(--background)",
                    color: "var(--foreground)",
                  }}
                  value={localTitle}
                  maxLength={NODE_CONSTRAINTS.title.max}
                  disabled={data.pending}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLocalTitle(val);
                    resizeEl(e.target);
                    updateNodeFields(id, { title: val });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onKeyDown={handleTitleKeyDown}
                />
              ) : data.url ? (
                <a
                  href={data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nodrag nopan text-sm leading-tight font-semibold break-words underline"
                  style={{ color: descriptor.accent }}
                >
                  {data.title}
                </a>
              ) : (
                <span className="text-sm leading-tight font-semibold break-words">{data.title}</span>
              )}
            </div>
            {isEditing && (
              <div className="mt-0.5 flex items-center justify-between">
                {!localTitle ? (
                  <span className="text-[9px]" style={{ color: "var(--destructive)" }}>
                    Title is required
                  </span>
                ) : (
                  <span />
                )}
                <span
                  className="text-[9px]"
                  style={{
                    color:
                      localTitle.length > NODE_CONSTRAINTS.title.warnAt
                        ? "var(--destructive)"
                        : "var(--muted-foreground)",
                  }}
                >
                  {localTitle.length}/{NODE_CONSTRAINTS.title.max}
                </span>
              </div>
            )}
          </div>

          {/* URL — source nodes in edit mode only, above a divider */}
          {isEditing && role === "source" && (
            <>
              <div className="nodrag nopan px-3 pt-2 pb-1">
                <input
                  ref={urlRef}
                  className="nodrag nopan w-full rounded border px-1.5 py-0.5 text-xs outline-none"
                  style={{
                    borderColor: !localUrl || !isValidUrl(localUrl) ? "var(--destructive)" : "var(--border)",
                    backgroundColor: "var(--background)",
                    color: "var(--foreground)",
                  }}
                  value={localUrl}
                  placeholder="https://... (required)"
                  disabled={data.pending}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLocalUrl(val);
                    updateNodeFields(id, { url: val || undefined });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onKeyDown={handleUrlKeyDown}
                />
                {(!localUrl || !isValidUrl(localUrl)) && (
                  <span className="mt-1 block text-[9px]" style={{ color: "var(--destructive)" }}>
                    {!localUrl ? "URL is required for source nodes" : "Must be a valid URL (e.g. https://example.com)"}
                  </span>
                )}
              </div>
              <div className="mx-3 mb-1" style={{ height: 1, backgroundColor: cardBorder }} />
            </>
          )}

          {/* Body */}
          <div className="px-3 py-2">
            {isEditing ? (
              <div className="nodrag nopan flex flex-col gap-0.5">
                <textarea
                  ref={(el) => {
                    bodyRef.current = el;
                    if (el) resizeEl(el);
                  }}
                  className="nodrag nopan w-full resize-none overflow-hidden rounded border px-1.5 py-0.5 text-xs leading-relaxed outline-none"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--background)",
                    color: "var(--foreground)",
                    minHeight: 48,
                  }}
                  value={localBody}
                  maxLength={NODE_CONSTRAINTS.body.max}
                  rows={3}
                  disabled={data.pending}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLocalBody(val);
                    resizeEl(e.target);
                    updateNodeFields(id, { body: val });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onKeyDown={handleBodyKeyDown}
                />
                <span
                  className="self-end text-[9px]"
                  style={{
                    color:
                      localBody.length > NODE_CONSTRAINTS.body.warnAt
                        ? "var(--destructive)"
                        : "var(--muted-foreground)",
                  }}
                >
                  {localBody.length}/{NODE_CONSTRAINTS.body.max}
                </span>
              </div>
            ) : (
              <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                {data.body}
              </p>
            )}
          </div>

          {/* Mark control — inline bar for the challenger to mark advocate statements.
              Stays visible read-only after the turn is submitted (interactive only while
              `canMarkThisNode`). A marked statement gets the light-red challenger tint +
              a little padding behind the bar so it reads as "touched by the challenger". */}
          {showMarkBar && (
            <div
              className="nodrag nopan flex flex-col border-t"
              style={{
                borderColor: cardBorder,
                // The tint reads as "challenger touched this" only on an advocate (white)
                // card; a challenger card is already tinted, so the bar blends in there.
                backgroundColor: isChallenger ? "var(--card)" : CHALLENGER_TINT,
                padding: 2,
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              {isStale && (
                <div className="pb-1 text-center text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>
                  CHANGED: Need re-evaluation
                </div>
              )}
              <div className="flex" style={{ gap: 2 }}>
                {MARK_STANCES.map((stance) => {
                  const d = markStanceDescriptors[stance];
                  const active = currentMark === stance;
                  return (
                    <button
                      key={stance}
                      className="flex flex-1 items-center justify-center rounded py-1 text-[10px] font-semibold transition-colors"
                      style={{
                        // Inactive buttons sit on white so only the padding/gap shows the
                        // light-red tint as thin "quasi-borders"; the active one is tinted.
                        color: active ? d.color : "var(--muted-foreground)",
                        backgroundColor: active ? `color-mix(in srgb, ${d.color} 18%, var(--card))` : "var(--card)",
                        cursor: canMarkThisNode ? "pointer" : "default",
                        // Dim the active stance when stale so the viewer knows re-marking is required.
                        opacity: active && isStale ? 0.45 : 1,
                      }}
                      title={d.label}
                      disabled={!canMarkThisNode}
                      onClick={() => {
                        setMark(id, stance);
                      }}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {/* Orphan emphasis drawn as an overlay on TOP of all content (incl. the full-bleed mark
            bar), so the amber ring is never covered. Inset shadows keep it inside the card —
            a solid inner ring that bites slightly into the content, then a glow fading inward.
            pointer-events:none so it never intercepts clicks on the node/mark bar. */}
        {showOrphanWarning && (
          <div
            className="pointer-events-none absolute inset-0 z-20 rounded-lg"
            style={{
              boxShadow: "inset 0 0 40px 12px color-mix(in srgb, #d97706 40%, transparent)",
            }}
          />
        )}
      </div>
      <Handle
        type="target"
        position={Position.Bottom}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          transform: "none",
          opacity: 0,
          borderRadius: "inherit",
          pointerEvents: inProgress && !data.pending ? "auto" : "none",
        }}
      />
      {badgeDropdown}
    </>
  );
}
