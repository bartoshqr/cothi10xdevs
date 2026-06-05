import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createNodeSchema, debateIdParamSchema } from "@/lib/debate/schemas";
import { createStatementNode, createConnectiveNode, getDebateGraph } from "@/lib/debate/repository";

export const GET = withAuth(async (context, supabase) => {
  const idParsed = debateIdParamSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return Response.json({ error: "Invalid debate id" }, { status: 400 });
  }

  const graph = await getDebateGraph(supabase, idParsed.data);
  if (!graph) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(graph.nodes);
});

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

  const parsed = createNodeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const node =
    parsed.data.nodeKind === "statement"
      ? await createStatementNode(supabase, parsed.data, user.id)
      : await createConnectiveNode(supabase, parsed.data, user.id);
  return Response.json(node, { status: 201 });
});
