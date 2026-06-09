import { z } from "zod";
import { ROUND_COUNT } from "./constants";

export const openExchangeSchema = z
  .object({
    debateId: z.uuid(),
    challengerId: z.uuid(),
    roundCount: z.number().int().min(ROUND_COUNT.min).max(ROUND_COUNT.max),
  })
  .strict();

export const respondInviteSchema = z
  .object({
    accept: z.boolean(),
  })
  .strict();

// Lenient: partial substrings won't satisfy the full USERNAME_PATTERN; empty = match-all.
export const usernameSearchSchema = z
  .object({
    username: z.string().max(30).optional().default(""),
  })
  .strict();

export const exchangeIdParamSchema = z.uuid();

export type OpenExchangeInput = z.infer<typeof openExchangeSchema>;
export type RespondInviteInput = z.infer<typeof respondInviteSchema>;
export type UsernameSearchInput = z.infer<typeof usernameSearchSchema>;
