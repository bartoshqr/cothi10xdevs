import { z } from "zod";
import { Constants } from "@/db/database.types";

export const markStanceSchema = z.enum(Constants.public.Enums.mark_stance);

export const upsertMarkSchema = z
  .object({
    nodeId: z.uuid(),
    stance: markStanceSchema,
  })
  .strict();

export type MarkStance = z.infer<typeof markStanceSchema>;
export type UpsertMarkInput = z.infer<typeof upsertMarkSchema>;
