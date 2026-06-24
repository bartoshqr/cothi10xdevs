import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    // `local` scope clears only this session's cookies; the default `global`
    // scope revokes every refresh token for the user across all devices —
    // signing out one browser would kick the same account out everywhere.
    await supabase.auth.signOut({ scope: "local" });
  }
  return context.redirect("/");
};
