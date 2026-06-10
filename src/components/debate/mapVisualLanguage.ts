export const MENU_VIEWPORT_MARGIN = 16;

export type StatementRole = "claim" | "source" | "data" | "warrant" | "backing" | "rebuttal";

// Re-exported from the mark schema so the stance union follows the generated DB enum
// (Constants.public.Enums.mark_stance) instead of drifting as a hand-typed copy.
import type { MarkStance } from "@/lib/mark/schemas";
export type { MarkStance };

export type ConnectiveOp = "and" | "or";

export type RelationKind = "supports" | "link" | "rephrases" | "rebuts" | "pending";

/**
 * Target-handle ids on a connective node. `link` edges route into the operand body;
 * supports/rephrases/rebuts edges route to the outer bottom point. Statement nodes have a
 * single unnamed target handle, so their edges leave `targetHandle` undefined.
 */
export const CONNECTIVE_OPERAND_HANDLE = "for-operands";
export const CONNECTIVE_OUTER_HANDLE = "outer";

export interface RoleDescriptor {
  accent: string;
  badge: string | null;
}

export interface ConnectiveDescriptor {
  label: string;
  bg: string;
  border: string;
  text: string;
}

export interface RelationDescriptor {
  label: string;
  color: string;
  strokeDasharray?: string;
  strokeWidth?: number;
}

export const roleDescriptors: Record<StatementRole, RoleDescriptor> = {
  claim: { accent: "var(--muted-foreground)", badge: "CLAIM" },
  source: { accent: "var(--primary)", badge: "SOURCE" },
  data: { accent: "var(--chart-3)", badge: "DATA" },
  warrant: { accent: "var(--chart-5)", badge: "WARRANT" },
  backing: { accent: "var(--chart-2)", badge: "BACKING" },
  rebuttal: { accent: "var(--destructive)", badge: "REBUTTAL" },
};

export const connectiveDescriptors: Record<ConnectiveOp, ConnectiveDescriptor> = {
  and: {
    label: "AND",
    bg: "var(--muted)",
    border: "var(--border)",
    text: "var(--foreground)",
  },
  or: {
    label: "OR",
    bg: "var(--muted)",
    border: "var(--border)",
    text: "var(--foreground)",
  },
};

export interface MarkStanceDescriptor {
  label: string;
  color: string;
}

export const markStanceDescriptors: Record<MarkStance, MarkStanceDescriptor> = {
  agree: { label: "Agree", color: "var(--chart-2)" },
  challenge: { label: "Challenge", color: "var(--destructive)" },
  abstain: { label: "Abstain", color: "var(--muted-foreground)" },
};

/**
 * Light-red tint for challenger-side content — their own statement cards, and the
 * mark bar on an advocate statement they have marked. Matches the Challenge stance
 * hue (`var(--destructive)` at 12%, the same mix the Challenge button uses).
 */
export const CHALLENGER_TINT = "color-mix(in srgb, var(--destructive) 12%, var(--card))";

export const relationDescriptors: Record<RelationKind, RelationDescriptor> = {
  supports: {
    label: "supports",
    color: "var(--chart-2)",
  },
  link: {
    label: "link",
    color: "var(--muted-foreground)",
    strokeDasharray: "10 2",
  },
  rephrases: {
    label: "rephrases",
    color: "var(--muted-foreground)",
    strokeDasharray: "3 3",
  },
  rebuts: {
    label: "rebuts",
    color: "var(--destructive)",
    strokeWidth: 3,
  },
  pending: {
    label: "",
    color: "var(--muted-foreground)",
  },
};
