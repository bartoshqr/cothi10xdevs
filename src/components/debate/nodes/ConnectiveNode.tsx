import { Handle, Position } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { connectiveDescriptors } from "../mapVisualLanguage";
import type { ConnectiveOp } from "../mapVisualLanguage";

export interface ConnectiveNodeData extends Record<string, unknown> {
  op: ConnectiveOp;
  pending?: boolean;
}

export type ConnectiveNodeType = Node<ConnectiveNodeData, "connective">;

const hiddenHandle: CSSProperties = {
  background: "transparent",
  border: "none",
  width: 6,
  height: 6,
};

export default function ConnectiveNode({ data }: NodeProps<ConnectiveNodeType>) {
  const descriptor = connectiveDescriptors[data.op];

  return (
    <>
      <Handle type="source" position={Position.Top} id="out" style={hiddenHandle} />
      <div
        className="flex items-center justify-center rounded-full border-2 text-xs font-bold"
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
      <Handle type="target" position={Position.Bottom} id="in" style={hiddenHandle} />
    </>
  );
}
