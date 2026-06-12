import { withAuth } from "@/lib/api";
import { debateIdParamSchema } from "@/lib/debate/schemas";
import { getDivergenceSummary } from "@/lib/summary/repository";

export const GET = withAuth(async (context, supabase) => {
  const idParsed = debateIdParamSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return Response.json({ error: "Invalid debate id" }, { status: 400 });
  }

  const summary = await getDivergenceSummary({ supabase, debateId: idParsed.data });
  // null covers both the unmet round gate and an unknown/RLS-scoped-out debate — the
  // repository can't tell a non-member apart from a too-early member, so both are 404.
  if (!summary) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(summary);
});
