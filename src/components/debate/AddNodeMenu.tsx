import { useRef, useLayoutEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useStore } from "./store";
import { roleDescriptors, connectiveDescriptors, MENU_VIEWPORT_MARGIN } from "./mapVisualLanguage";
import type { StatementRole, ConnectiveOp } from "./mapVisualLanguage";

const STATEMENT_ROLES: StatementRole[] = ["claim", "source", "data", "warrant", "backing", "rebuttal"];

interface Props {
  screenX: number;
  screenY: number;
  onClose: () => void;
}

export default function AddNodeMenu({ screenX, screenY, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  useLayoutEffect(() => {
    if (menuRef.current) {
      setFlipped(screenY + menuRef.current.offsetHeight + MENU_VIEWPORT_MARGIN > window.innerHeight);
    }
  }, [screenY]);

  const { screenToFlowPosition } = useReactFlow();
  const createStatementNode = useStore((s) => s.createStatementNode);
  const createConnectiveNode = useStore((s) => s.createConnectiveNode);

  function handleStatement(role: StatementRole) {
    const position = screenToFlowPosition({ x: screenX, y: screenY });
    createStatementNode(role, position);
    onClose();
  }

  function handleConnective(op: ConnectiveOp) {
    const position = screenToFlowPosition({ x: screenX, y: screenY });
    createConnectiveNode(op, position);
    onClose();
  }

  return (
    <>
      {/* backdrop */}
      <div
        className="nodrag nopan fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className="nodrag nopan fixed z-50 overflow-hidden rounded-lg shadow-lg"
        style={{
          left: screenX,
          top: screenY,
          transform: flipped ? "translateY(-100%)" : undefined,
          minWidth: 180,
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--card-foreground)",
        }}
      >
        <div
          className="px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase"
          style={{ color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}
        >
          Add node
        </div>

        {STATEMENT_ROLES.map((role) => {
          const d = roleDescriptors[role];
          return (
            <button
              key={role}
              className="nodrag nopan flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--muted)]"
              onClick={() => {
                handleStatement(role);
              }}
            >
              <div className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: d.accent }} />
              {d.badge ? (
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase"
                  style={{ backgroundColor: d.accent }}
                >
                  {d.badge}
                </span>
              ) : (
                <span className="text-[11px] capitalize" style={{ color: "var(--muted-foreground)" }}>
                  claim
                </span>
              )}
            </button>
          );
        })}

        <div
          className="mt-0.5 px-3 py-1 text-[10px] font-bold tracking-wider uppercase"
          style={{ color: "var(--muted-foreground)", borderTop: "1px solid var(--border)" }}
        >
          Connective
        </div>

        {(["and", "or"] as ConnectiveOp[]).map((op) => {
          const d = connectiveDescriptors[op];
          return (
            <button
              key={op}
              className="nodrag nopan flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--muted)]"
              onClick={() => {
                handleConnective(op);
              }}
            >
              <div
                className="flex items-center justify-center rounded-full border-2 font-bold"
                style={{
                  width: 36,
                  height: 20,
                  fontSize: 9,
                  backgroundColor: d.bg,
                  borderColor: d.border,
                  color: d.text,
                }}
              >
                {d.label}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
