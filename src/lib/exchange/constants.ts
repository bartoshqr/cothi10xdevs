// Single source of truth for exchange limits (lessons §3).
// DB CHECK constraints mirror these values — update both together.
export const ROUND_COUNT = { min: 1, max: 5, default: 3 } as const;

// Cap on the username search dropdown (mirrored by the React island and the API endpoint).
export const USER_SEARCH_LIMIT = 5;
