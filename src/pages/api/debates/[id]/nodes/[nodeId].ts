import { z } from "zod";
import { withAuth } from "@/lib/api";
import { updateNodeSchema, nodeIdParamSchema } from "@/lib/debate/schemas";
import { updateNode, deleteNode } from "@/lib/debate/repository";

export const PATCH = withAuth(async (context, supabase) => {
  const nodeIdParsed = nodeIdParamSchema.safeParse(context.params.nodeId);
  if (!nodeIdParsed.success) {
    return Response.json({ error: "Invalid node id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateNodeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  try {
    const node = await updateNode(supabase, nodeIdParsed.data, parsed.data);
    return Response.json(node);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});

export const DELETE = withAuth(async (context, supabase) => {
  const nodeIdParsed = nodeIdParamSchema.safeParse(context.params.nodeId);
  if (!nodeIdParsed.success) {
    return Response.json({ error: "Invalid node id" }, { status: 400 });
  }

  try {
    await deleteNode(supabase, nodeIdParsed.data);
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});
