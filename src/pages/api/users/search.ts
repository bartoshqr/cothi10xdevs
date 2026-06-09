import { withAuth } from "@/lib/api";
import { searchUsersByUsername } from "@/lib/users";
import { USER_SEARCH_LIMIT } from "@/lib/exchange/constants";
import { usernameSearchSchema } from "@/lib/exchange/schemas";
import { z } from "zod";

export const GET = withAuth(async (context, supabase, user) => {
  const raw = { username: context.url.searchParams.get("username") ?? "" };
  const parsed = usernameSearchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const users = await searchUsersByUsername(supabase, parsed.data.username, user.id, USER_SEARCH_LIMIT);
  return Response.json({ users });
});
