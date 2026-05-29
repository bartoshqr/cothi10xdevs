export const MENU_VIEWPORT_MARGIN = 16;

export type StatementRole = "claim" | "source" | "data" | "warrant" | "backing" | "rebuttal";

export type ConnectiveOp = "and" | "or";

export type RelationKind = "supports" | "link" | "rephrases" | "rebuts";

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
};
