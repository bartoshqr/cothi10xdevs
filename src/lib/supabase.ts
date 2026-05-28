import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";
import type { User } from "@supabase/supabase-js";

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  const authHeader = requestHeaders.get("Authorization");
  const globalHeaders: Record<string, string> = authHeader?.startsWith("Bearer ") ? { Authorization: authHeader } : {};
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: globalHeaders },
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
      },
    },
  });
}

/**
 * Resolve the authenticated user from either an Authorization: Bearer header
 * (programmatic callers) or the cookie-based SSR session (browser). Returns
 * null when neither is present or the token is invalid.
 */
export async function getAuthUser(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  requestHeaders: Headers,
): Promise<User | null> {
  const authHeader = requestHeaders.get("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const {
    data: { user },
  } = await supabase.auth.getUser(bearerToken);
  return user;
}
