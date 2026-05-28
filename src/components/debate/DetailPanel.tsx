import { Panel } from "@xyflow/react";
import { useStore, useShallow } from "./store";
import { roleDescriptors, connectiveDescriptors } from "./mapVisualLanguage";
import type { StatementRole, ConnectiveOp } from "./mapVisualLanguage";
import type { ConnectiveNodeType } from "./nodes/ConnectiveNode";

const STATEMENT_ROLES: StatementRole[] = ["claim", "source", "data", "warrant", "backing", "rebuttal"];

export default function DetailPanel() {
  const { nodes, selectedNodeId, selectNode, updateNodeFields } = useStore(
    useShallow((s) => ({
      nodes: s.nodes,
      selectedNodeId: s.selectedNodeId,
      selectNode: s.selectNode,
      updateNodeFields: s.updateNodeFields,
    })),
  );

  const node = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

  if (!node) return null;

  function close() {
    selectNode(null);
  }

  if (node.type === "statement") {
    const sNode = node;
    const role = sNode.data.role ?? "claim";
    const descriptor = roleDescriptors[role];
    const badge = sNode.data.isRoot ? "ROOT" : descriptor.badge;

    return (
      <Panel position="top-right" style={{ padding: 0, margin: "8px 8px 0 0" }}>
        <div
          className="nodrag nopan flex flex-col gap-0 overflow-hidden rounded-lg shadow-lg"
          style={{
            width: 280,
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--card-foreground)",
          }}
        >
          {/* Header: role badge selector + close */}
          <div
            className="flex items-center justify-between gap-2 px-3 py-2"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div className="flex flex-wrap gap-1">
              {STATEMENT_ROLES.map((r) => {
                const d = roleDescriptors[r];
                const isActive = r === role;
                const activeBadge = sNode.data.isRoot && r === "claim" ? "ROOT" : d.badge;
                return (
                  <button
                    key={r}
                    title={r}
                    className="nodrag nopan rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider transition-opacity"
                    style={{
                      backgroundColor: isActive ? d.accent : "var(--muted)",
                      color: isActive ? "white" : "var(--muted-foreground)",
                      border: `1px solid ${isActive ? d.accent : "var(--border)"}`,
                      opacity: isActive ? 1 : 0.6,
                    }}
                    onClick={() => {
                      updateNodeFields(node.id, { statementType: r });
                    }}
                  >
                    {activeBadge ?? r.toUpperCase()}
                  </button>
                );
              })}
            </div>
            <button
              className="nodrag nopan shrink-0 text-xs"
              style={{ color: "var(--muted-foreground)" }}
              onClick={close}
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>

          {/* Accent bar */}
          <div className="h-0.5 w-full" style={{ backgroundColor: descriptor.accent }} />

          {/* Title */}
          <div className="flex flex-col gap-1 px-3 pt-3 pb-1">
            <div className="flex items-center justify-between">
              <label
                className="text-[10px] font-bold tracking-wider uppercase"
                style={{ color: "var(--muted-foreground)" }}
              >
                Title
              </label>
              <span
                className="text-[10px]"
                style={{
                  color: sNode.data.title.length > 50 ? "var(--destructive)" : "var(--muted-foreground)",
                }}
              >
                {sNode.data.title.length}/60
              </span>
            </div>
            <input
              className="nodrag nopan w-full rounded border px-2 py-1 text-sm"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--background)", color: "var(--foreground)" }}
              value={sNode.data.title}
              maxLength={60}
              onChange={(e) => {
                updateNodeFields(node.id, { title: e.target.value });
              }}
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1 px-3 pt-1 pb-3">
            <div className="flex items-center justify-between">
              <label
                className="text-[10px] font-bold tracking-wider uppercase"
                style={{ color: "var(--muted-foreground)" }}
              >
                Body
              </label>
              <span
                className="text-[10px]"
                style={{
                  color: sNode.data.body.length > 220 ? "var(--destructive)" : "var(--muted-foreground)",
                }}
              >
                {sNode.data.body.length}/250
              </span>
            </div>
            <textarea
              className="nodrag nopan w-full rounded border px-2 py-1 text-xs"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--background)",
                color: "var(--foreground)",
                resize: "vertical",
                minHeight: 64,
              }}
              value={sNode.data.body}
              maxLength={250}
              onChange={(e) => {
                updateNodeFields(node.id, { body: e.target.value });
              }}
            />
          </div>

          {/* URL — only for source nodes */}
          {role === "source" && (
            <div className="flex flex-col gap-1 px-3 pb-3">
              <label
                className="text-[10px] font-bold tracking-wider uppercase"
                style={{ color: "var(--muted-foreground)" }}
              >
                URL
              </label>
              <input
                className="nodrag nopan w-full rounded border px-2 py-1 text-xs"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--background)",
                  color: "var(--foreground)",
                }}
                value={sNode.data.url ?? ""}
                placeholder="https://..."
                onChange={(e) => {
                  updateNodeFields(node.id, { url: e.target.value || undefined });
                }}
              />
            </div>
          )}

          {/* Badge display reference */}
          <div
            className="flex items-center gap-2 px-3 py-1.5"
            style={{ borderTop: "1px solid var(--border)", backgroundColor: "var(--muted)" }}
          >
            {badge ? (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase"
                style={{ backgroundColor: descriptor.accent }}
              >
                {badge}
              </span>
            ) : (
              <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                plain claim
              </span>
            )}
            <span className="truncate text-[10px]" style={{ color: "var(--muted-foreground)" }}>
              {sNode.data.title}
            </span>
          </div>
        </div>
      </Panel>
    );
  }

  {
    const connectiveNode: ConnectiveNodeType = node;
    const ops: ConnectiveOp[] = ["and", "or"];

    return (
      <Panel position="top-right" style={{ padding: 0, margin: "8px 8px 0 0" }}>
        <div
          className="nodrag nopan overflow-hidden rounded-lg shadow-lg"
          style={{
            width: 200,
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--card-foreground)",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <span
              className="text-[10px] font-bold tracking-wider uppercase"
              style={{ color: "var(--muted-foreground)" }}
            >
              Connective
            </span>
            <button
              className="nodrag nopan text-xs"
              style={{ color: "var(--muted-foreground)" }}
              onClick={close}
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
          <div className="flex gap-2 p-3">
            {ops.map((op) => {
              const d = connectiveDescriptors[op];
              const isActive = connectiveNode.data.op === op;
              return (
                <button
                  key={op}
                  className="nodrag nopan flex flex-1 items-center justify-center rounded-full border-2 font-bold transition-opacity"
                  style={{
                    height: 36,
                    fontSize: 12,
                    backgroundColor: isActive ? d.bg : "var(--background)",
                    borderColor: isActive ? d.border : "var(--border)",
                    color: isActive ? d.text : "var(--muted-foreground)",
                    opacity: isActive ? 1 : 0.5,
                  }}
                  onClick={() => {
                    updateNodeFields(node.id, { connectiveOp: op });
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      </Panel>
    );
  }

  return null;
}
