import { useStore } from "./store";

interface Props {
  edgeId: string;
  screenX: number;
  screenY: number;
  onClose: () => void;
  onEdit: () => void;
}

export default function EdgeContextMenu({ edgeId, screenX, screenY, onClose, onEdit }: Props) {
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
        className="nodrag nopan fixed z-50 overflow-hidden rounded-lg shadow-lg"
        style={{
          left: screenX,
          top: screenY,
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
