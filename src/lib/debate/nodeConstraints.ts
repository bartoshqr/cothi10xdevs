import { z } from "zod";

export const NODE_CONSTRAINTS = {
  title: { max: 60, warnAt: 50 },
  body: { max: 250, warnAt: 220 },
} as const;

export const statementNodeSchema = z.object({
  title: z.string().min(1, "Title is required").max(NODE_CONSTRAINTS.title.max),
  body: z.string().max(NODE_CONSTRAINTS.body.max),
  url: z.url("Must be a valid URL").optional(),
});

export type StatementNodeInput = z.infer<typeof statementNodeSchema>;
