import { withAuth } from "@/lib/api";
import { debateIdParamSchema } from "@/lib/debate/schemas";
import { getDebateGraph } from "@/lib/debate/repository";

export const GET = withAuth(async (context, supabase) => {
  const idParsed = debateIdParamSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return Response.json({ error: "Invalid debate id" }, { status: 400 });
  }

  try {
    // RLS scopes the read to the owner; a non-owner (or unknown id) gets null → 404.
    const graph = await getDebateGraph(supabase, idParsed.data);
    if (!graph) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(graph);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});
