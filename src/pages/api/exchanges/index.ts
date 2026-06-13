import { withAuth } from "@/lib/api";
import { openExchange } from "@/lib/exchange/repository";
import { listMyDebates } from "@/lib/debate/repository";
import { openExchangeSchema } from "@/lib/exchange/schemas";
import { z } from "zod";

// GET — returns the viewer's active challenger debates (pending + accepted exchanges
// where viewer is the challenger). Used by ChallengerSection to poll for new invites.
export const GET = withAuth(async (_context, supabase, user) => {
  const all = await listMyDebates(supabase, user.id);
  const items = all
    .filter(
      (d): d is typeof d & { exchange_id: string } =>
        d.role === "challenger" && (d.state === "awaiting" || d.state === "in_progress") && d.exchange_id !== null,
    )
    .map((d) => ({
      exchange_id: d.exchange_id,
      debate_id: d.id,
      debate_title: d.title,
      root_claim_title: d.root_claim_title,
      advocate_username: d.other_username,
      round_count: d.round_count,
      current_round: d.current_round,
      initial_status: d.state === "awaiting" ? "pending" : "accepted",
    }));
  return Response.json({ items });
});

export const POST = withAuth(async (context, supabase, user) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = openExchangeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const exchange = await openExchange(supabase, parsed.data, user.id);
  return Response.json({ id: exchange.id });
});
