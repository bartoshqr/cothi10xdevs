import { z } from "zod";
import { Constants } from "@/db/database.types";
import { NODE_CONSTRAINTS } from "./nodeConstraints";

const { statement_type, connective_op, relation_kind } = Constants.public.Enums;

export const statementTypeEnum = z.enum(statement_type);
export const connectiveOpEnum = z.enum(connective_op);
export const relationKindEnum = z.enum(relation_kind);

export const createDebateSchema = z.object({
  title: z.string().min(1).max(120),
  rootTitle: z.string().min(1).max(NODE_CONSTRAINTS.title.max),
  rootBody: z.string().max(NODE_CONSTRAINTS.body.max).optional(),
});

export const createNodeSchema = z.discriminatedUnion("nodeKind", [
  z.object({
    nodeKind: z.literal("statement"),
    debateId: z.uuid(),
    statementType: statementTypeEnum,
    title: z.string().min(1).max(NODE_CONSTRAINTS.title.max),
    body: z.string().max(NODE_CONSTRAINTS.body.max).optional(),
    url: z.url().optional(),
    positionX: z.number(),
    positionY: z.number(),
  }),
  z.object({
    nodeKind: z.literal("connective"),
    debateId: z.uuid(),
    connectiveOp: connectiveOpEnum,
    positionX: z.number(),
    positionY: z.number(),
  }),
]);

export const updateNodeSchema = z.object({
  title: z.string().min(1).max(NODE_CONSTRAINTS.title.max).optional(),
  body: z.string().max(NODE_CONSTRAINTS.body.max).optional(),
  url: z.url().optional(),
  statementType: statementTypeEnum.optional(),
  connectiveOp: connectiveOpEnum.optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});

export const createRelationSchema = z.object({
  debateId: z.uuid(),
  sourceNodeId: z.uuid(),
  targetNodeId: z.uuid(),
  kind: relationKindEnum,
});

export const updateRelationSchema = z.object({
  kind: relationKindEnum,
});

export const nodeIdParamSchema = z.uuid();
export const relationIdParamSchema = z.uuid();
export const debateIdParamSchema = z.uuid();

export type CreateDebateInput = z.infer<typeof createDebateSchema>;
export type CreateNodeInput = z.infer<typeof createNodeSchema>;
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;
export type CreateRelationInput = z.infer<typeof createRelationSchema>;
export type UpdateRelationInput = z.infer<typeof updateRelationSchema>;
