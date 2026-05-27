import { ReactFlow, ReactFlowProvider, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

function MapSpikeCanvasInner() {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow fitView fitViewOptions={{ padding: 0.2 }}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export default function MapSpikeCanvas() {
  return (
    <ReactFlowProvider>
      <MapSpikeCanvasInner />
    </ReactFlowProvider>
  );
}
