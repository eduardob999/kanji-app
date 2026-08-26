/**
 * Shown when src/firebaseConfig.ts still holds template values. Without this,
 * the first click on "Sign in with Google" fails with `auth/invalid-api-key`,
 * which says nothing about what to actually do.
 */
export function SetupNotice() {
  return (
    <main className="screen screen--centred">
      <section className="card setup">
        <h1 className="card__title">Finish the Firebase setup</h1>
        <p className="card__body">
          The app is running, but it has no Firebase project to talk to yet.
        </p>

        <ol className="setup__steps">
          <li>
            Create a project at <strong>console.firebase.google.com</strong>, then add a Web app to
            it.
          </li>
          <li>
            Under <strong>Authentication → Sign-in method</strong>, enable <strong>Google</strong>.
          </li>
          <li>
            Under <strong>Firestore Database</strong>, create a database and publish the rules from{' '}
            <code>firestore.rules</code>.
          </li>
          <li>
            Copy the SDK config values into <code>.env.local</code> (see <code>.env.example</code>)
            or straight into <code>src/firebaseConfig.ts</code>.
          </li>
        </ol>

        <p className="card__hint">The dev server picks up the change on restart.</p>
      </section>
    </main>
  );
}
