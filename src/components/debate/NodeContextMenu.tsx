import { useRef, useLayoutEffect, useState } from "react";
import { useStore } from "./store";
import { MENU_VIEWPORT_MARGIN, connectiveDescriptors } from "./mapVisualLanguage";
import type { ConnectiveOp } from "./mapVisualLanguage";

interface Props {
  nodeId: string;
  screenX: number;
  screenY: number;
  onClose: () => void;
}

export default function NodeContextMenu({ nodeId, screenX, screenY, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  useLayoutEffect(() => {
    if (menuRef.current) {
      setFlipped(screenY + menuRef.current.offsetHeight + MENU_VIEWPORT_MARGIN > window.innerHeight);
    }
  }, [screenY]);

  const node = useStore((s) => s.nodes.find((n) => n.id === nodeId));
  const deleteNodes = useStore((s) => s.deleteNodes);
  const setInEditNode = useStore((s) => s.setInEditNode);
  const updateNodeFields = useStore((s) => s.updateNodeFields);

  const isConnective = node?.type === "connective";
  const currentOp = isConnective ? (node.data as { op: ConnectiveOp }).op : null;
  const oppositeOp: ConnectiveOp | null = currentOp === "and" ? "or" : currentOp === "or" ? "and" : null;
  // The root claim can never be deleted (only re-designated via "Set as Root"), so don't
  // offer Delete for it — otherwise the click always fails with the root-delete error banner.
  const isRoot = node?.type === "statement" && node.data.isRoot === true;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
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
          minWidth: 160,
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--card-foreground)",
        }}
      >
        {isConnective && oppositeOp ? (
          <button
            className="nodrag nopan flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]"
            onClick={() => {
              updateNodeFields(nodeId, { connectiveOp: oppositeOp });
              onClose();
            }}
          >
            Switch to
            <span
              className="rounded-full border-2 px-2 py-0.5 text-[10px] font-bold"
              style={{
                borderColor: connectiveDescriptors[oppositeOp].border,
                color: connectiveDescriptors[oppositeOp].text,
                backgroundColor: connectiveDescriptors[oppositeOp].bg,
              }}
            >
              {connectiveDescriptors[oppositeOp].label}
            </span>
          </button>
        ) : (
          <button
            className="nodrag nopan w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]"
            onClick={() => {
              setInEditNode(nodeId);
              onClose();
            }}
          >
            Edit
          </button>
        )}
        {!isRoot && (
          <button
            className="nodrag nopan w-full border-t px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]"
            style={{ borderColor: "var(--border)", color: "var(--destructive)" }}
            onClick={() => {
              deleteNodes([nodeId]);
              onClose();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </>
  );
}
