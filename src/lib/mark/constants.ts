import { Constants } from "@/db/database.types";

// Single source of truth for stance values — surfaced straight from the generated DB enum
// so the UI/schema list can never drift from the schema. Order follows the enum
// declaration (accept, challenge, abstain).
// DB enum: supabase/migrations/20260610000001_create_marks_and_authorship.sql
export const MARK_STANCES = Constants.public.Enums.mark_stance;
