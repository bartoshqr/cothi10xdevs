import { Handle, Position, useConnection } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { roleDescriptors } from "../mapVisualLanguage";
import type { StatementRole } from "../mapVisualLanguage";
import { useStore, useShallow } from "../store";

export interface StatementNodeData extends Record<string, unknown> {
  role?: StatementRole;
  title: string;
  body: string;
  url?: string;
  isRoot?: boolean;
  pending?: boolean;
}

export type StatementNodeType = Node<StatementNodeData, "statement">;

const STATEMENT_ROLES: StatementRole[] = ["claim", "source", "data", "warrant", "backing", "rebuttal"];

export default function StatementNode({ id, data }: NodeProps<StatementNodeType>) {
  const { inProgress } = useConnection();
  const { editingNodeId, setEditingNode, updateNodeFields, setRootNode, deleteNodes } = useStore(
    useShallow((s) => ({
      editingNodeId: s.editingNodeId,
      setEditingNode: s.setEditingNode,
      updateNodeFields: s.updateNodeFields,
      setRootNode: s.setRootNode,
      deleteNodes: s.deleteNodes,
    })),
  );

  const isEditing = editingNodeId === id;
  const [badgeAnchor, setBadgeAnchor] = useState<{ x: number; y: number } | null>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);

  const role = data.isRoot ? "claim" : (data.role ?? "claim");
  const descriptor = roleDescriptors[role];
  const badge = data.isRoot ? "ROOT" : descriptor.badge;

  function handleNodeDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setEditingNode(id);
  }

  function resizeEl(el: HTMLElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleBadgeClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (data.isRoot) return;
    const rect = badgeRef.current?.getBoundingClientRect();
    if (rect) setBadgeAnchor({ x: rect.left, y: rect.bottom + 4 });
  }

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
              className="fixed z-50 overflow-hidden rounded-lg shadow-lg"
              style={{
                left: badgeAnchor.x,
                top: badgeAnchor.y,
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
                const isActive = r === role;
                const displayBadge = data.isRoot && r === "claim" ? "ROOT" : (d.badge ?? r.toUpperCase());
                return (
                  <button
                    key={r}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--muted)]"
                    onClick={() => {
                      updateNodeFields(id, { statementType: r });
                      setBadgeAnchor(null);
                    }}
                  >
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase"
                      style={{ backgroundColor: d.accent, opacity: isActive ? 1 : 0.45 }}
                    >
                      {displayBadge}
                    </span>
                  </button>
                );
              })}
              {!data.isRoot && (
                <>
                  <div style={{ borderTop: "1px solid var(--border)" }} />
                  <button
                    className="flex w-full items-center px-3 py-1.5 text-left text-xs font-semibold transition-colors hover:bg-[var(--muted)]"
                    style={{ color: "var(--primary)" }}
                    onClick={() => {
                      updateNodeFields(id, { statementType: "claim" }); // controversial, let's check with users
                      setRootNode(id);
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
      {!data.isRoot && (
        <Handle
          type="source"
          position={Position.Top}
          style={{
            background: descriptor.accent,
            border: "2px solid white",
            width: 12,
            height: 12,
            boxShadow: `0 0 0 2px ${descriptor.accent}44`,
          }}
        />
      )}
      <div
        className="relative flex max-w-[300px] min-w-[280px] overflow-hidden rounded-lg shadow-sm"
        style={{
          border: `1px solid ${isEditing ? descriptor.accent : "var(--border)"}`,
          backgroundColor: "var(--card)",
          color: "var(--card-foreground)",
          opacity: data.pending ? 0.6 : 1,
        }}
        onDoubleClick={handleNodeDoubleClick}
      >
        {isEditing && (
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
          <div
            className={`border-b py-1.5 pl-3 ${isEditing ? "pr-6" : "pr-3"}`}
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex items-center gap-2">
              {badge && (
                <span
                  ref={badgeRef}
                  className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wider text-white uppercase select-none"
                  style={{ backgroundColor: descriptor.accent }}
                  title="Click to change role"
                  onClick={handleBadgeClick}
                >
                  {badge}
                </span>
              )}
              {isEditing ? (
                <textarea
                  ref={(el) => {
                    if (el) {
                      resizeEl(el);
                      el.focus();
                      el.selectionStart = el.selectionEnd = el.value.length;
                    }
                  }}
                  rows={1}
                  className="nodrag nopan min-w-0 flex-1 resize-none overflow-hidden rounded border px-1.5 py-0.5 text-sm font-semibold outline-none"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--background)",
                    color: "var(--foreground)",
                  }}
                  value={data.title}
                  maxLength={60}
                  onChange={(e) => {
                    resizeEl(e.target);
                    updateNodeFields(id, { title: e.target.value });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
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
              <div className="mt-0.5 flex justify-end">
                <span
                  className="text-[9px]"
                  style={{ color: data.title.length > 50 ? "var(--destructive)" : "var(--muted-foreground)" }}
                >
                  {data.title.length}/60
                </span>
              </div>
            )}
          </div>

          {/* URL — source nodes in edit mode only, above a divider */}
          {isEditing && role === "source" && (
            <>
              <div className="nodrag nopan px-3 pt-2 pb-1">
                <input
                  className="nodrag nopan w-full rounded border px-1.5 py-0.5 text-xs outline-none"
                  style={{
                    borderColor: !data.url ? "var(--destructive)" : "var(--border)",
                    backgroundColor: "var(--background)",
                    color: "var(--foreground)",
                  }}
                  value={data.url ?? ""}
                  placeholder="https://... (required)"
                  onChange={(e) => {
                    updateNodeFields(id, { url: e.target.value || undefined });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                />
                {!data.url && (
                  <span className="mt-1 block text-[9px]" style={{ color: "var(--destructive)" }}>
                    URL is required for source nodes
                  </span>
                )}
              </div>
              <div className="mx-3 mb-1" style={{ height: 1, backgroundColor: "var(--border)" }} />
            </>
          )}

          {/* Body */}
          <div className="px-3 py-2">
            {isEditing ? (
              <div className="nodrag nopan flex flex-col gap-0.5">
                <textarea
                  ref={(el) => {
                    if (el) resizeEl(el);
                  }}
                  className="nodrag nopan w-full resize-none overflow-hidden rounded border px-1.5 py-0.5 text-xs leading-relaxed outline-none"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--background)",
                    color: "var(--foreground)",
                    minHeight: 48,
                  }}
                  value={data.body}
                  maxLength={250}
                  rows={3}
                  onChange={(e) => {
                    resizeEl(e.target);
                    updateNodeFields(id, { body: e.target.value });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                />
                <span
                  className="self-end text-[9px]"
                  style={{ color: data.body.length > 220 ? "var(--destructive)" : "var(--muted-foreground)" }}
                >
                  {data.body.length}/250
                </span>
              </div>
            ) : (
              <p className="text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
                {data.body}
              </p>
            )}
          </div>
        </div>
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
          pointerEvents: inProgress ? "auto" : "none",
        }}
      />
      {badgeDropdown}
    </>
  );
}
