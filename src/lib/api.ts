import type { APIContext, APIRoute } from "astro";
import type { User } from "@supabase/supabase-js";
import { createClient, getAuthUser } from "@/lib/supabase";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

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
      // A well-formed request that breaks a structural domain rule is a 422
      // (Unprocessable Entity), not a server error — D1 link-target guard.
      if (err instanceof ValidationError) {
        return Response.json({ error: err.message }, { status: 422 });
      }
      // A valid request that collides with persisted state (e.g. deleting the
      // root claim, blocked by the deferred root FK) is a 409, not a 500 — D3-3a.
      if (err instanceof ConflictError) {
        return Response.json({ error: err.message }, { status: 409 });
      }
      // Log the real error server-side; never leak Postgres/Supabase internals
      // (constraint names, RPC messages) to the client — impl-review F3.
      // eslint-disable-next-line no-console
      console.error("API handler error:", err);
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
