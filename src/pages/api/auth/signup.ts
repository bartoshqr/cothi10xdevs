import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { USERNAME_PATTERN, normalizeUsername } from "@/lib/username";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;
  const username = normalizeUsername(form.get("username") as string);

  if (!USERNAME_PATTERN.test(username)) {
    return context.redirect(
      `/auth/signup?error=${encodeURIComponent("Username must be 3-30 characters: letters, numbers, underscore")}`,
    );
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // Pre-flight check for a clean "taken" message in the common case. The unique
  // index below is still the authority for the concurrent-signup race.
  const { data: available } = await supabase.rpc("username_available", { check_username: username });
  if (available === false) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("That username is taken")}`);
  }

  const { error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });

  if (error) {
    // The DB unique index is the authority. Format is already validated above,
    // so the only trigger failure left is a duplicate username — which GoTrue
    // masks as a generic "Database error saving new user". Map both forms.
    const message = /duplicate|unique|profiles_username|database error saving new user/i.test(error.message)
      ? "That username is taken"
      : error.message;
    return context.redirect(`/auth/signup?error=${encodeURIComponent(message)}`);
  }

  return context.redirect("/auth/confirm-email");
};
