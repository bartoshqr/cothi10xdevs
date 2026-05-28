import { z } from "zod";
import { withAuth } from "@/lib/api";
import { createDebateSchema } from "@/lib/debate/schemas";
import { createDebate } from "@/lib/debate/repository";

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

  try {
    const id = await createDebate(supabase, parsed.data);
    return Response.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});
