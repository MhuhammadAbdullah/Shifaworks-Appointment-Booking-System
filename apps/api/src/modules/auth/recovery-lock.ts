/**
 * A session established by clicking a password-reset link is real (Supabase
 * issued it), but it only proves access to an inbox, not the password — if
 * that session is left sitting on the "set a new password" screen, anyone
 * who later gets the device, or just refreshes without submitting, would
 * otherwise land in the dashboard with no password or email ever entered.
 * So a "recovery" session can do exactly one thing (change the password)
 * until the frontend confirms that happened, via confirmRecoverySession().
 *
 * Per-process, keyed by Supabase's session_id (the JWT's `sid` claim) — one
 * instance converges within a request or two of another instance confirming
 * it, which is fine here since the user is sitting on the same screen either way.
 */
const confirmed = new Set<string>();

export function isRecoveryLocked(token: { authMethod: string | null; sessionId: string | null }): boolean {
  if (token.authMethod !== "recovery") return false;
  // No session id to key the confirmation on — fail closed rather than trust it blindly.
  if (!token.sessionId) return true;
  return !confirmed.has(token.sessionId);
}

export function confirmRecoverySession(sessionId: string): void {
  confirmed.add(sessionId);
  if (confirmed.size > 5_000) confirmed.clear(); // cheap bound for a long-running process
}
