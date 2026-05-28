import { Handle, Position, useConnection } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { connectiveDescriptors } from "../mapVisualLanguage";
import type { ConnectiveOp } from "../mapVisualLanguage";

export interface ConnectiveNodeData extends Record<string, unknown> {
  op: ConnectiveOp;
  pending?: boolean;
}

export type ConnectiveNodeType = Node<ConnectiveNodeData, "connective">;

export default function ConnectiveNode({ data }: NodeProps<ConnectiveNodeType>) {
  const { inProgress } = useConnection();
  const descriptor = connectiveDescriptors[data.op];

  return (
    <>
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
      <div
        className="relative flex items-center justify-center rounded-full border-2 text-xs font-bold"
        style={{
          width: "64px",
          height: "36px",
          backgroundColor: descriptor.bg,
          borderColor: descriptor.border,
          color: descriptor.text,
          opacity: data.pending ? 0.6 : 1,
        }}
      >
        {descriptor.label}
      </div>
      <Handle
        type="target"
        position={Position.Bottom}
        id="in"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          transform: "none",
          opacity: 0,
          borderRadius: "50%",
          pointerEvents: inProgress ? "auto" : "none",
        }}
      />
    </>
  );
}
