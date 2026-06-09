import { withAuth } from "@/lib/api";
import { respondToInvite } from "@/lib/exchange/repository";
import { exchangeIdParamSchema, respondInviteSchema } from "@/lib/exchange/schemas";
import { z } from "zod";

export const POST = withAuth(async (context, supabase) => {
  const idParsed = exchangeIdParamSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return Response.json({ error: "Invalid exchange id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = respondInviteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const exchange = await respondToInvite(supabase, idParsed.data, parsed.data.accept);
  return Response.json({ status: exchange.status });
});
