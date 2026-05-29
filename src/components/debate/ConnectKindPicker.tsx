import { useRef, useLayoutEffect, useState } from "react";
import { Panel } from "@xyflow/react";
import { useStore } from "./store";
import { relationDescriptors, MENU_VIEWPORT_MARGIN } from "./mapVisualLanguage";
import type { RelationKind } from "./mapVisualLanguage";

const KINDS: RelationKind[] = ["supports", "rephrases", "rebuts"];

interface Props {
  /** When set, we're changing an existing edge's kind. When null, we're committing a new connection. */
  edgeId?: string;
  onClose: () => void;
  /** When provided, render as a fixed overlay at this viewport position instead of a Panel. */
  position?: { x: number; y: number };
}

export default function ConnectKindPicker({ edgeId, onClose, position }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  useLayoutEffect(() => {
    if (position && menuRef.current) {
      setFlipped(position.y + menuRef.current.offsetHeight + MENU_VIEWPORT_MARGIN > window.innerHeight);
    }
  }, [position]);

  const commitConnection = useStore((s) => s.commitConnection);
  const cancelConnection = useStore((s) => s.cancelConnection);
  const updateRelationKind = useStore((s) => s.updateRelationKind);

  function handleKind(kind: RelationKind) {
    if (edgeId) {
      updateRelationKind(edgeId, kind);
    } else {
      commitConnection(kind);
    }
    onClose();
  }

  function handleCancel() {
    if (!edgeId) cancelConnection();
    onClose();
  }

  const inner = (
    <div
      className="nodrag nopan rounded-lg shadow-lg"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        color: "var(--card-foreground)",
        minWidth: 200,
      }}
    >
      <div
        className="px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase"
        style={{ color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}
      >
        {edgeId ? "Change relation kind" : "Choose relation kind"}
      </div>
      {KINDS.map((kind) => {
        const d = relationDescriptors[kind];
        return (
          <button
            key={kind}
            className="nodrag nopan flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]"
            onClick={() => {
              handleKind(kind);
            }}
          >
            <svg width="28" height="10" overflow="visible" className="shrink-0">
              <line
                x1="0"
                y1="5"
                x2="28"
                y2="5"
                stroke={d.color}
                strokeWidth={d.strokeWidth ?? 2}
                strokeDasharray={d.strokeDasharray}
              />
              <polygon points="24,2 28,5 24,8" fill={d.color} />
            </svg>
            <span style={{ color: d.color, fontWeight: 600 }}>{kind}</span>
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {d.label}
            </span>
          </button>
        );
      })}
      <div style={{ borderTop: "1px solid var(--border)" }}>
        <button
          className="nodrag nopan w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--muted)]"
          style={{ color: "var(--muted-foreground)" }}
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  if (position) {
    return (
      <div
        ref={menuRef}
        className="nodrag nopan fixed z-50"
        style={{
          left: position.x,
          top: position.y,
          transform: flipped ? "translateY(-100%)" : undefined,
        }}
      >
        {inner}
      </div>
    );
  }

  return (
    <Panel position="top-center" style={{ padding: 0 }}>
      {inner}
    </Panel>
  );
}
