/**
 * Shown instead of the listening quiz when the device has no Japanese voice.
 *
 * Says how to get one rather than just refusing: on most devices it is a
 * settings toggle away, and "this mode does not work here" without that is a
 * dead end.
 */
export function NoVoiceNotice() {
  return (
    <section className="card">
      <h1 className="card__title">No Japanese voice</h1>
      <p className="card__body">
        This device has no Japanese speech voice installed, so there is nothing to listen to. Every
        other mode works normally.
      </p>
      <p className="card__hint">
        On Android, Japanese can usually be added under Settings → System → Languages →
        Text-to-speech. On iOS it arrives with the Japanese keyboard, or under Accessibility →
        Spoken Content → Voices.
      </p>
    </section>
  );
}
