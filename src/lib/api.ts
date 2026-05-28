import type { APIContext, APIRoute } from "astro";
import type { User } from "@supabase/supabase-js";
import { createClient, getAuthUser } from "@/lib/supabase";

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

    return handler(context, supabase, user);
  };
}
