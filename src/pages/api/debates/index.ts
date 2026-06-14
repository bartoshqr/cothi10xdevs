import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createDebateSchema } from "@/lib/debate/schemas";
import { createDebate, listMyDebates } from "@/lib/debate/repository";

// GET — returns all debates the viewer participates in (both roles), used by
// AdvocateSection and ChallengerSection to poll for any-field live updates.
export const GET = withAuth(async (_context, supabase, user) => {
  const debates = await listMyDebates(supabase, user.id);
  return Response.json({ debates });
});

export const POST = withAuth(async (context, supabase) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createDebateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const id = await createDebate(supabase, parsed.data);
  return Response.json({ id });
});
