export const NODE_CONSTRAINTS = {
  title: { max: 60, warnAt: 50 },
  body: { max: 250, warnAt: 220 },
} as const;

// Debate-level limits. The title lives in a page header (more room than a canvas node).
// Mirrors the DB check `char_length(title) <= 120` in the create_debate_graph migration.
export const DEBATE_CONSTRAINTS = {
  title: { max: 120, warnAt: 110 },
} as const;

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
