import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { USERNAME_PATTERN, normalizeUsername } from "@/lib/username";

export const GET: APIRoute = async (context) => {
  const username = normalizeUsername(context.url.searchParams.get("u") ?? "");

  if (!USERNAME_PATTERN.test(username)) {
    return Response.json({ available: false, reason: "invalid" });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ available: false, reason: "unconfigured" }, { status: 503 });
  }

  const { data, error } = await supabase.rpc("username_available", { check_username: username });
  if (error) {
    return Response.json({ available: false, reason: "error" }, { status: 500 });
  }

  return Response.json({ available: data });
};
