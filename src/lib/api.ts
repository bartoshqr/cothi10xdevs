import type { APIContext, APIRoute } from "astro";
import type { User } from "@supabase/supabase-js";
import { createClient, getAuthUser } from "@/lib/supabase";
import { NotFoundError } from "@/lib/errors";

type DB = NonNullable<ReturnType<typeof createClient>>;

type AuthedHandler = (context: APIContext, supabase: DB, user: User) => Response | Promise<Response>;

export function withAuth(handler: AuthedHandler): APIRoute {
  return async (context) => {
    const supabase = createClient(context.request.headers, context.cookies);
    if (!supabase) {
      return Response.json({ error: "Supabase is not configured" }, { status: 503 });
    }

    const user = await getAuthUser(supabase, context.request.headers);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      return await handler(context, supabase, user);
    } catch (err) {
      // A row hidden by RLS (or absent) is a 404, not a server error — F4.
      if (err instanceof NotFoundError) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      // Log the real error server-side; never leak Postgres/Supabase internals
      // (constraint names, RPC messages) to the client — impl-review F3.
      // eslint-disable-next-line no-console
      console.error("API handler error:", err);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
