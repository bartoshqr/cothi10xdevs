import { withAuth } from "@/lib/api";
import { exchangeIdParamSchema } from "@/lib/exchange/schemas";
import { submitTurn } from "@/lib/exchange/repository";

export const POST = withAuth(async (context, supabase) => {
  const idParsed = exchangeIdParamSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return Response.json({ error: "Invalid exchange id" }, { status: 400 });
  }

  const exchange = await submitTurn(supabase, idParsed.data);
  return Response.json(exchange);
});
