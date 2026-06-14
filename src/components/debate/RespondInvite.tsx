import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  exchangeId: string;
  onResolved: (accepted: boolean) => void;
}

export default function RespondInvite({ exchangeId, onResolved }: Props) {
  const [loading, setLoading] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(accept: boolean) {
    setLoading(accept ? "accept" : "decline");
    setError(null);
    try {
      const res = await fetch(`/api/exchanges/${exchangeId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(typeof json.error === "string" ? json.error : "Something went wrong.");
        return;
      }
      onResolved(accept);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={loading !== null} onClick={() => void respond(true)}>
          {loading === "accept" ? "Accepting…" : "Accept"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading !== null}
          onClick={() => void respond(false)}
        >
          {loading === "decline" ? "Declining…" : "Decline"}
        </Button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
