/**
 * Maps the database's named error codes to messages for people.
 *
 * Every rule these describe is enforced in Postgres, not here — this only
 * decides how the refusal reads. See supabase/migrations for the rules
 * themselves.
 */
const MESSAGES: Record<string, string> = {
  SF001: "That crew member still has open work orders assigned.",
  SF002: "That captain is the last active captain of a vessel with open work.",
  SF003: "This is the last active admin — promote another first.",
  SF004: "That crew member still has open work aboard this vessel.",
  SF005: "That captain is the only active captain of this vessel.",
  SF006: "This vessel still has open work orders.",
  SF007: "Admins are not assigned to vessels; their access is fleet-wide.",
  SF010: "No active session. Choose a member in the bar above.",
  SF011: "This account has been deactivated.",
  SF012: "Only captains may raise, attest, or reject work orders.",
  SF013: "You are not assigned to this vessel.",
  SF014: "This vessel is deactivated.",
  SF015: "That crew member is not available.",
  SF016: "Work orders may only be assigned to crew.",
  SF017: "That crew member is not assigned to this vessel.",
  SF018: "That work order no longer exists.",
  SF019: "Only the assigned crew member may do that.",
  SF020: "This work order is closed and can no longer be changed.",
  SF021: "That status change is not allowed.",
  SF022: "Attestation cannot be withdrawn.",
  SF023: "A work order cannot be moved between vessels.",
  SF024: "Document the solution before marking this done.",
  SF025: "Only work orders marked done can be reviewed.",
  SF026: "A rejection must say what needs putting right.",
  SF027: "Only a captain of this vessel, or an admin, may reassign work.",
  SF028: "This work order is already under way.",
  SF029: "This is with the captain for review and cannot be edited.",
  "23505": "That record already exists.",
  "23514": "Some required details are missing or invalid.",
  "42501": "You do not have permission to do that.",
};

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

export function humanError(error: unknown): string {
  const e = error as PostgrestLikeError;
  if (e?.code && MESSAGES[e.code]) {
    // The database's own message is more specific (it names the person or
    // vessel), so prefer it and fall back to the generic wording.
    return e.message?.replace(/^ERROR:\s*/, "") || MESSAGES[e.code];
  }
  if (e?.message) return e.message;
  return "Something went wrong.";
}
