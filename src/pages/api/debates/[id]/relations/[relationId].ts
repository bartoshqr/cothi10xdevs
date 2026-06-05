import { z } from "zod";
import { withAuth } from "@/lib/api";
import { updateRelationSchema, relationIdParamSchema } from "@/lib/debate/schemas";
import { updateRelation, deleteRelation } from "@/lib/debate/repository";

export const PATCH = withAuth(async (context, supabase) => {
  const relIdParsed = relationIdParamSchema.safeParse(context.params.relationId);
  if (!relIdParsed.success) {
    return Response.json({ error: "Invalid relation id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateRelationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const relation = await updateRelation(supabase, relIdParsed.data, parsed.data);
  return Response.json(relation);
});

export const DELETE = withAuth(async (context, supabase) => {
  const relIdParsed = relationIdParamSchema.safeParse(context.params.relationId);
  if (!relIdParsed.success) {
    return Response.json({ error: "Invalid relation id" }, { status: 400 });
  }

  await deleteRelation(supabase, relIdParsed.data);
  return new Response(null, { status: 204 });
});
