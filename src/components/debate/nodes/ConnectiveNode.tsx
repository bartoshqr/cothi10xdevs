import { Handle, Position, useConnection } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { connectiveDescriptors, CONNECTIVE_OPERAND_HANDLE, CONNECTIVE_OUTER_HANDLE } from "../mapVisualLanguage";
import type { ConnectiveOp } from "../mapVisualLanguage";

export interface ConnectiveNodeData extends Record<string, unknown> {
  op: ConnectiveOp;
  pending?: boolean;
}

export type ConnectiveNodeType = Node<ConnectiveNodeData, "connective">;

export default function ConnectiveNode({ id, data }: NodeProps<ConnectiveNodeType>) {
  const { inProgress, toNode } = useConnection();
  const isActiveTarget = inProgress && toNode?.id === id;
  const descriptor = connectiveDescriptors[data.op];

  return (
    <>
      {!data.pending && (
        <Handle
          type="source"
          position={Position.Top}
          id="out"
          style={{
            background: descriptor.border,
            border: "2px solid white",
            width: 10,
            height: 10,
            boxShadow: `0 0 0 2px ${descriptor.border}44`,
          }}
        />
      )}
      <div
        className="relative flex items-center justify-center rounded-full border-2 text-xs font-bold"
        style={{
          width: "64px",
          height: "36px",
          backgroundColor: descriptor.bg,
          borderColor: isActiveTarget ? "var(--primary)" : descriptor.border,
          boxShadow: isActiveTarget ? "0 0 0 3px color-mix(in srgb, var(--primary) 30%, transparent)" : undefined,
          color: descriptor.text,
          opacity: data.pending ? 0.6 : 1,
        }}
      >
        {descriptor.label}
      </div>
      {/* Full-body catch-all — link edges visually route here */}
      <Handle
        type="target"
        position={Position.Bottom}
        id={CONNECTIVE_OPERAND_HANDLE}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          transform: "none",
          opacity: 0,
          borderRadius: "50%",
          pointerEvents: inProgress && !data.pending ? "auto" : "none",
        }}
      />
      {/* Bottom-edge point — supports/rephrases/rebuts edges visually route here */}
      <Handle
        type="target"
        position={Position.Bottom}
        id={CONNECTIVE_OUTER_HANDLE}
        style={{
          background: "var(--muted-foreground)",
          border: "2px solid white",
          width: 8,
          height: 8,
          opacity: 0,
          pointerEvents: inProgress && !data.pending ? "auto" : "none",
          zIndex: 1,
        }}
      />
    </>
  );
}
