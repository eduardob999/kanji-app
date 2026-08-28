import { persistenceStatus } from '../firebase';
import { AppMark } from './AppMark';

/**
 * Where everything in the app came from.
 *
 * Two jobs. The first is an obligation: Tatoeba is CC-BY, Kanji Canvas is MIT
 * with a required backlink, and KanjiVG is CC-BY-SA. `LICENSES.md` satisfies
 * the letter of that for anyone reading the repository, but the people using
 * the app are the ones looking at the sentences and the stroke recognition, and
 * they never see the repository.
 *
 * The second is to say plainly what the app knows about you and where it is
 * kept, which is a fair thing to be able to find without reading source code.
 */

const REPO = 'https://github.com/eduardob999/kanji-app';

interface CreditProps {
  what: string;
  href: string;
  name: string;
  licence: string;
  children: React.ReactNode;
}

function Credit({ what, href, name, licence, children }: CreditProps) {
  return (
    <li className="credit">
      <p className="credit__what">{what}</p>
      <p className="credit__who">
        <a href={href} rel="noreferrer">
          {name}
        </a>
        <span className="credit__licence">{licence}</span>
      </p>
      <p className="credit__note">{children}</p>
    </li>
  );
}

export function AboutPanel() {
  return (
    <section className="card">
      <div className="about__head">
        <AppMark size={64} />
        <div>
          <h1 className="card__title">Kanjiba</h1>
          <p className="about__version">
            version {__APP_VERSION__} · <a href={REPO} rel="noreferrer">source</a>
          </p>
        </div>
      </div>

      <p className="card__body">
        JLPT kanji and vocabulary, scheduled so that each item comes back just before you would
        have forgotten it. It replaces a command-line app of the same idea, and keeps its data.
      </p>

      <h2 className="card__subtitle">Built on</h2>
      <ul className="credits">
        <Credit
          what="Example sentences"
          href="https://tatoeba.org"
          name="Tatoeba"
          licence="CC-BY 2.0 FR"
        >
          Every sentence in the fill-in and listening quizzes. Each keeps its Tatoeba id, so the
          quiz can link back to the contributor who wrote it.
        </Credit>

        <Credit
          what="Handwriting recognition"
          href="https://github.com/asdfjkl/kanjicanvas"
          name="Kanji Canvas"
          licence="MIT"
        >
          © 2019–2024 Dominik Klein; © 2020 Seth Clydesdale. Recognises a drawn character without
          caring about stroke order, and runs entirely on your device.
        </Credit>

        <Credit
          what="Stroke data"
          href="https://kanjivg.tagaini.net/"
          name="KanjiVG"
          licence="CC BY-SA 3.0"
        >
          © Ulrich Apel. Kanji Canvas's reference patterns derive from it, and the 205 characters
          it does not cover — mostly the kanji that turn up in names — are generated here from
          KanjiVG directly. Either way the patterns shipped here carry the same terms.
        </Credit>

        <Credit
          what="Scheduling"
          href="https://github.com/open-spaced-repetition"
          name="FSRS"
          licence="open source"
        >
          A model of forgetting, rather than a rule of thumb. It starts from published averages and
          fits itself to you — see <strong>Tools → Scheduler</strong>.
        </Credit>

        <Credit
          what="Kanji and vocabulary lists"
          href="https://github.com/eduardob999/kanji-practice-app"
          name="kanji-practice-app"
          licence="predecessor"
        >
          2,211 kanji and 7,235 words, carried over unchanged from the command-line app this one
          replaces.
        </Credit>
      </ul>

      <p className="card__hint">
        Full notices in <a href={`${REPO}/blob/main/LICENSES.md`} rel="noreferrer">LICENSES.md</a>.
      </p>

      <h2 className="card__subtitle">Your data</h2>
      <dl className="datalist">
        <div className="datalist__row">
          <dt>Stored</dt>
          <dd>Firestore, under your Google account</dd>
        </div>
        <div className="datalist__row">
          <dt>On this device</dt>
          <dd>
            {persistenceStatus === 'persistent' ? 'IndexedDB, shared across tabs' : 'in memory only'}
          </dd>
        </div>
        <div className="datalist__row">
          <dt>Shared with</dt>
          <dd>Guitar Practice Companion</dd>
        </div>
      </dl>
      <p className="card__hint">
        Kept: your name, email and review history. Nothing else, and nothing is sent anywhere but
        Firebase. The Firebase project is shared with{' '}
        <a href="https://github.com/eduardob999/GHAPP" rel="noreferrer">
          Guitar Practice Companion
        </a>{' '}
        so that one sign-in covers both — they are the same browser origin. The two apps write to
        separate collections and neither can overwrite the other’s.
      </p>
      <p className="card__hint">
        Speech happens on your device through the browser’s own voice; no audio is recorded or
        sent. Handwriting is recognised on your device too.
      </p>
    </section>
  );
}
