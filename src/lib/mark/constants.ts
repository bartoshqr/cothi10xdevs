// Single source of truth for stance values — mirrors the DB enum mark_stance.
// DB enum: supabase/migrations/20260610000001_create_marks_and_authorship.sql
export const MARK_STANCES = ["agree", "challenge", "abstain"] as const;
