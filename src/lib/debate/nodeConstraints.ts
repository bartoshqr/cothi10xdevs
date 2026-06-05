import { z } from "zod";

export const NODE_CONSTRAINTS = {
  title: { max: 60, warnAt: 50 },
  body: { max: 250, warnAt: 220 },
} as const;

// Debate-level limits. The title lives in a page header (more room than a canvas node).
// Mirrors the DB check `char_length(title) <= 120` in the create_debate_graph migration.
export const DEBATE_CONSTRAINTS = {
  title: { max: 120, warnAt: 110 },
} as const;

export const statementNodeSchema = z.object({
  title: z.string().min(1, "Title is required").max(NODE_CONSTRAINTS.title.max),
  body: z.string().max(NODE_CONSTRAINTS.body.max),
  url: z.url("Must be a valid URL").optional(),
});

export type StatementNodeInput = z.infer<typeof statementNodeSchema>;

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
