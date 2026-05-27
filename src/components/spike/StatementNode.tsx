import { Handle, Position } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { roleDescriptors } from "./mapVisualLanguage";
import type { StatementRole } from "./mapVisualLanguage";

export interface StatementNodeData extends Record<string, unknown> {
  role?: StatementRole;
  title: string;
  body: string;
  url?: string;
  isRoot?: boolean;
}

export type StatementNodeType = Node<StatementNodeData, "statement">;

const hiddenHandle: CSSProperties = {
  background: "transparent",
  border: "none",
  width: 8,
  height: 8,
};

export default function StatementNode({ data }: NodeProps<StatementNodeType>) {
  const role = data.role ?? "claim";
  const descriptor = roleDescriptors[role];
  const badge = data.isRoot ? "ROOT" : descriptor.badge;

  return (
    <>
      <Handle type="source" position={Position.Top} style={hiddenHandle} />
      <div
        className="flex max-w-[300px] min-w-[280px] overflow-hidden rounded-lg shadow-sm"
        style={{
          border: "1px solid var(--border)",
          backgroundColor: "var(--card)",
          color: "var(--card-foreground)",
        }}
      >
        <div className="w-1 shrink-0" style={{ backgroundColor: descriptor.accent }} />
        <div className="flex-1">
          <div className="flex items-center gap-2 border-b px-3 py-1.5" style={{ borderColor: "var(--border)" }}>
            {badge && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wider text-white uppercase"
                style={{ backgroundColor: descriptor.accent }}
              >
                {badge}
              </span>
            )}
            {data.url ? (
              <a
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                className="nodrag nopan text-sm leading-tight font-semibold underline"
                style={{ color: descriptor.accent }}
              >
                {data.title}
              </a>
            ) : (
              <span className="text-sm leading-tight font-semibold">{data.title}</span>
            )}
          </div>
          <div className="px-3 py-2 text-xs leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            {data.body}
          </div>
        </div>
      </div>
      <Handle type="target" position={Position.Bottom} style={hiddenHandle} />
    </>
  );
}
