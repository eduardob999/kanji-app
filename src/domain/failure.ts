/**
 * Turning a thrown thing into a sentence worth reading.
 *
 * Six places in this app put `error.message` on screen, and the messages they
 * put there were written for whoever wrote the library: "Failed to fetch",
 * "Missing or insufficient permissions", "The query requires an index". None of
 * them says whose fault it is, whether anything was lost, or what to do — which
 * are the only three things the person reading it wants.
 *
 * The rule here is that the exception goes to the console and a sentence goes
 * to the screen. Where the cause is genuinely distinguishable and genuinely
 * actionable — a signed-out session, a connection that is simply not there —
 * the sentence says so; everywhere else the caller supplies a fallback that
 * describes *what was being attempted*, which is more use than the failure.
 *
 * Pure, so it is testable and so nothing here can throw on the way to
 * reporting a throw.
 */

/** Firebase puts a stable machine-readable code on its errors; browsers do not. */
function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

/**
 * A cause the reader can act on, or null when there is nothing honest to add.
 *
 * Deliberately short. A list that tries to explain every Firestore code becomes
 * a list of sentences nobody can verify, and a wrong explanation is worse than
 * no explanation.
 */
function knownCause(error: unknown): string | null {
  const code = codeOf(error);
  const message = messageOf(error);

  if (code === 'permission-denied' || code === 'auth/user-token-expired') {
    return 'Your session is no longer signed in. Signing in again should fix it — nothing stored is lost.';
  }

  if (
    code === 'unavailable' ||
    code === 'auth/network-request-failed' ||
    /Failed to fetch|NetworkError|network error/i.test(message)
  ) {
    return 'There is no connection to the server right now. Anything you answer is kept on this device and sent when there is.';
  }

  if (code === 'resource-exhausted') {
    return 'The server is refusing requests for the moment. Nothing is lost; try again shortly.';
  }

  return null;
}

/**
 * @param fallback what was being attempted, as a sentence — used whenever the
 * cause is not one of the few worth naming. Write it for a learner, not for a
 * log.
 */
export function describeFailure(error: unknown, fallback: string): string {
  return knownCause(error) ?? fallback;
}
