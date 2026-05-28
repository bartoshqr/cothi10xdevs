import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createRelationSchema, debateIdParamSchema } from "@/lib/debate/schemas";
import { createRelation } from "@/lib/debate/repository";

export const POST = withAuth(async (context, supabase, user) => {
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

  const parsed = createRelationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  try {
    const relation = await createRelation(supabase, parsed.data, user.id);
    return Response.json(relation, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});
