/**
 * A screen that the navigation tree knows about and nothing has built yet.
 *
 * Preferable to leaving the node out of `navigation.ts` until its panel exists:
 * the tree is meant to be the map of the app, and a map that only shows the
 * finished parts cannot be used to check that the shape is right. Every one of
 * these is a placeholder with a scheduled removal.
 */
export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <section className="card">
      <h1 className="card__title">{title}</h1>
      <p className="card__body">{note}</p>
      <p className="notice notice--muted">Not built yet.</p>
    </section>
  );
}
