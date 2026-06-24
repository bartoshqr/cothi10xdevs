import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  debateId: string;
  initialPublic: boolean;
  isPublishable: boolean;
}

// S-09: lets the advocate flip a completed debate's `public` flag and surfaces
// a "View" link to the showcase page once published. Unpublish has no
// precondition and is a one-click, instantly reversible toggle (no confirm
// dialog by design).
//
// Deviation (approved during impl): when the debate is not yet publishable and
// not already public, this renders nothing — not a disabled button. The owner
// can't resolve "round not complete" with a click, so there's no affordance to show.
export default function PublishControl({ debateId, initialPublic, isPublishable }: Props) {
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isPublic && !isPublishable) return null;

  async function toggle() {
    const next = !isPublic;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/debates/${debateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public: next }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setError("Round not complete — this debate isn't publishable yet.");
        } else {
          const json = (await res.json()) as { error?: string };
          setError(typeof json.error === "string" ? json.error : "Something went wrong.");
        }
        return;
      }
      setIsPublic(next);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={isPublic ? "outline" : "ghost"}
        size="sm"
        disabled={loading}
        onClick={() => void toggle()}
      >
        {loading ? "Saving…" : isPublic ? "Unpublish" : "Publish"}
      </Button>
      {isPublic && (
        <Button type="button" variant="ghost" size="sm" asChild>
          <a href={`/showcase/${debateId}`}>View</a>
        </Button>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
