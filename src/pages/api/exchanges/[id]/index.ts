import { withAuth } from "@/lib/api";
import { getExchangeStatus, revokeInvite } from "@/lib/exchange/repository";
import { exchangeIdParamSchema } from "@/lib/exchange/schemas";

// GET — current status of an exchange (advocate status line + freshness poll).
// RLS scopes the row to the advocate or challenger; unknown/hidden → 404.
export const GET = withAuth(async (context, supabase) => {
  const idParsed = exchangeIdParamSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return Response.json({ error: "Invalid exchange id" }, { status: 400 });
  }

  const status = await getExchangeStatus(supabase, idParsed.data);
  if (!status) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(status);
});

// DELETE — advocate revokes a still-pending invite (re-opens editing + re-invite).
export const DELETE = withAuth(async (context, supabase, user) => {
  const idParsed = exchangeIdParamSchema.safeParse(context.params.id);
  if (!idParsed.success) {
    return Response.json({ error: "Invalid exchange id" }, { status: 400 });
  }

  await revokeInvite(supabase, idParsed.data, user.id);
  return Response.json({ ok: true });
});
