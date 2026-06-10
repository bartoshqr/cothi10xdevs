import { z } from "zod";
import { withAuth } from "@/lib/api";
import { debateIdParamSchema } from "@/lib/debate/schemas";
import { upsertMarkSchema } from "@/lib/mark/schemas";
import { upsertMark } from "@/lib/mark/repository";

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

  const parsed = upsertMarkSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const mark = await upsertMark({
    supabase,
    debateId: idParsed.data,
    nodeId: parsed.data.nodeId,
    markerId: user.id,
    stance: parsed.data.stance,
  });

  return Response.json(mark);
});
