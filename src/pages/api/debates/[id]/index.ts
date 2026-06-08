import { z } from "zod";
import { withAuth } from "@/lib/api";
import { debateIdParamSchema, updateDebateSchema } from "@/lib/debate/schemas";
import { getDebateGraph, setDebateRoot } from "@/lib/debate/repository";

export const GET = withAuth(async (context, supabase) => {
  const idParsed = debateIdParamSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return Response.json({ error: "Invalid debate id" }, { status: 400 });
  }

  // RLS scopes the read to the owner; a non-owner (or unknown id) gets null → 404.
  const graph = await getDebateGraph(supabase, idParsed.data);
  if (!graph) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(graph);
});

// D3-3c: re-designate the root claim. The body is whitelisted by updateDebateSchema
// (`.strict()`), so only `rootNodeId` can be written. setDebateRoot maps an unknown
// debate/node pair → 404 and a non-statement target → 422 via withAuth.
export const PATCH = withAuth(async (context, supabase) => {
  const idParsed = debateIdParamSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return Response.json({ error: "Invalid debate id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateDebateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  if (parsed.data.rootNodeId !== undefined) {
    const debate = await setDebateRoot(supabase, idParsed.data, parsed.data.rootNodeId);
    return Response.json(debate);
  }

  // No persistable field present — nothing to do.
  return Response.json({ error: "No supported fields to update" }, { status: 400 });
});
