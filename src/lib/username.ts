// Mirrors the DB CHECK constraint `profiles_username_format`. The DB is the
// authority; this is shared by the form, signup route, and availability endpoint
// for cheap format validation.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;

// Usernames are stored lowercase (the DB CHECK is lowercase-only). Users may type
// capitals; normalize before validating, checking availability, or submitting.
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}
