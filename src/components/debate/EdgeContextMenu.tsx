import { useRef, useLayoutEffect, useState } from "react";
import { useStore } from "./store";
import { MENU_VIEWPORT_MARGIN } from "./mapVisualLanguage";

interface Props {
  edgeId: string;
  screenX: number;
  screenY: number;
  onClose: () => void;
  onEdit: () => void;
}

export default function EdgeContextMenu({ edgeId, screenX, screenY, onClose, onEdit }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  useLayoutEffect(() => {
    if (menuRef.current) {
      setFlipped(screenY + menuRef.current.offsetHeight + MENU_VIEWPORT_MARGIN > window.innerHeight);
    }
  }, [screenY]);

  const deleteEdge = useStore((s) => s.deleteEdge);

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
          minWidth: 140,
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--card-foreground)",
        }}
      >
        <button
          className="nodrag nopan w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]"
          onClick={() => {
            onEdit();
            onClose();
          }}
        >
          Edit
        </button>
        <button
          className="nodrag nopan w-full border-t px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]"
          style={{ borderColor: "var(--border)", color: "var(--destructive)" }}
          onClick={() => {
            deleteEdge(edgeId);
            onClose();
          }}
        >
          Delete
        </button>
      </div>
    </>
  );
}
