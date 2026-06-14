import { withAuth } from "@/lib/api";
import { openExchange } from "@/lib/exchange/repository";
import { openExchangeSchema } from "@/lib/exchange/schemas";
import { z } from "zod";

export const POST = withAuth(async (context, supabase, user) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = openExchangeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const exchange = await openExchange(supabase, parsed.data, user.id);
  return Response.json({ id: exchange.id });
});
