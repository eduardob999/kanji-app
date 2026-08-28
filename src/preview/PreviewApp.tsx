import { useEffect, useState } from 'react';
import { AboutPanel } from '../components/AboutPanel';
import { AccountPanel } from '../components/AccountPanel';
import { BrowsePanel } from '../components/BrowsePanel';
import { InputMethodPanel } from '../components/InputMethodPanel';
import { ProgressPanel } from '../components/ProgressPanel';
import { SchedulerPanel } from '../components/SchedulerPanel';
import { SignInScreen } from '../components/SignInScreen';
import { SyncBadge } from '../components/SyncBadge';
import { AudioPanel } from '../quizzes/AudioPanel';
import { FillInPanel } from '../quizzes/FillInPanel';
import { KanjiWritingPanel } from '../quizzes/KanjiWritingPanel';
import { RandomPanel } from '../quizzes/RandomPanel';
import { SessionSummary, TodaySessionPanel } from '../quizzes/TodaySessionPanel';
import { VocabReadingPanel } from '../quizzes/VocabReadingPanel';
import { AnswerInput } from '../input/AnswerInput';
import { previewUser } from './fixtures';

/**
 * The answer inputs on their own.
 *
 * Handwriting and multiple choice only appear once chosen in a profile, which
 * the harness has no way to set — and they are the two most layout-sensitive
 * things in the app: a canvas that has to stay square and a candidate row that
 * wraps. Rendering them directly is the only way to look at them.
 */
function InputPreview({ method }: { method: 'handwriting' | 'choice' }) {
  const [value, setValue] = useState('');
  return (
    <section className="card quiz">
      <div className="quiz__prompt">
        <p className="quiz__readings" lang="ja">
          ド・ト・つち
        </p>
        <p className="quiz__gloss">soil; earth; ground; Turkey</p>
      </div>
      <div className="quiz__dock">
        <AnswerInput
          method={method}
          value={value}
          onChange={setValue}
          onSubmit={() => {}}
          disabled={false}
          placeholder="The character"
          {...(method === 'choice' ? { choices: ['土', '士', '工', '干'] } : {})}
        />
        <button type="button" className="button button--primary button--block">
          Check
        </button>
      </div>
    </section>
  );
}

/**
 * A way to look at every screen without signing in.
 *
 * The app is behind Google auth, so a headless browser sees the splash and
 * nothing else — which means layout can only be checked by holding a phone.
 * This route renders the real panels, with the real stylesheet, at whatever
 * viewport the browser is set to.
 *
 * Dev only. `main.tsx` gates on `import.meta.env.DEV`, which is a compile-time
 * constant, so none of this reaches a production bundle.
 *
 * Firestore is not configured here and its reads fail rather than hang — the
 * storage layer already falls back to an empty snapshot for exactly that case.
 * An empty review history is a real state worth checking anyway: it is what a
 * new account sees, and unseen items still produce questions, so the quiz
 * screens populate.
 */

const SCREENS = {
  today: ['Today’s Session', () => <TodaySessionPanel user={previewUser} />],
  random: ['Random', () => <RandomPanel user={previewUser} />],
  'random-silent': ['Random (silent)', () => <RandomPanel user={previewUser} silent />],
  sync: [
    'Sync states',
    () => (
      /*
       * All three at once, because in the app each appears only in a condition
       * the harness cannot create: "syncing" needs a write in flight, "synced"
       * needs a server round trip, and this build has no Firestore at all. Two
       * of the three had therefore never been measured, and the amber one was
       * under AA in the light theme.
       */
      <section className="card">
        <h1 className="card__title">Sync</h1>
        <div className="quiz__afterthoughts">
          <span className="topbar__status">offline</span>
          <span className="topbar__status topbar__status--pending">saving</span>
        </div>
        <div className="quiz__afterthoughts">
          <SyncBadge online fromCache={false} hasPendingWrites />
          <SyncBadge online fromCache hasPendingWrites={false} />
          <SyncBadge online={false} fromCache hasPendingWrites={false} />
          <SyncBadge online fromCache={false} hasPendingWrites={false} />
        </div>
      </section>
    ),
  ],
  summary: [
    'Session done',
    () => <SessionSummary offered={18} right={16} wrong={2} appetite={8} onAgain={() => {}} />,
  ],
  reading: ['Vocab reading', () => <VocabReadingPanel user={previewUser} />],
  writing: ['Kanji writing', () => <KanjiWritingPanel user={previewUser} />],
  fill: ['Fill in the blank', () => <FillInPanel user={previewUser} />],
  audio: ['Listening', () => <AudioPanel user={previewUser} />],
  browse: ['Browse', () => <BrowsePanel />],
  progress: ['Progress', () => <ProgressPanel user={previewUser} />],
  scheduler: ['Scheduler', () => <SchedulerPanel user={previewUser} />],
  input: ['Input method', () => <InputMethodPanel user={previewUser} />],
  account: ['Account', () => <AccountPanel user={previewUser} />],
  about: ['About', () => <AboutPanel />],
  handwriting: ['Handwriting input', () => <InputPreview method="handwriting" />],
  choice: ['Multiple choice input', () => <InputPreview method="choice" />],
  signin: ['Sign in', () => <SignInScreen />],
} as const satisfies Record<string, readonly [string, () => React.ReactNode]>;

type ScreenKey = keyof typeof SCREENS;

function screenFromHash(): ScreenKey | null {
  const key = window.location.hash.replace(/^#\/preview\/?/, '').trim();
  return key in SCREENS ? (key as ScreenKey) : null;
}

export function PreviewApp() {
  const [screen, setScreen] = useState<ScreenKey | null>(screenFromHash);

  useEffect(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!screen) {
    return (
      <main className="screen">
        <div className="content">
          <section className="card">
            <h1 className="card__title">Preview</h1>
            <p className="card__body">
              Every screen, without signing in. Dev builds only.
            </p>
            <ul className="menu">
              {(Object.keys(SCREENS) as ScreenKey[]).map((key) => (
                <li key={key}>
                  <a className="menu__item" href={`#/preview/${key}`}>
                    <span className="menu__title">{SCREENS[key][0]}</span>
                    <span className="menu__chevron" aria-hidden="true">
                      →
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    );
  }

  const [, render] = SCREENS[screen];

  // The same shell chrome the real app puts around a panel, so what is
  // screenshotted includes the padding and the tab bar that a panel actually
  // sits between.
  return (
    <div className="screen">
      <header className="topbar">
        <span className="topbar__where">{SCREENS[screen][0]}</span>
        {/*
          One chip, because the real header shows at most one — and rendering
          both wrapped the header onto a second line at 360px, which took
          eleven pixels off the handwriting screen and failed the audit. A
          harness that is harder on the layout than the app is not testing the
          app. The other state is measured on the Sync screen instead.
        */}
        <span className="topbar__status topbar__status--pending">saving</span>
      </header>
      <main className="content" id="main">
        {render()}
      </main>
      <nav className="tabbar" aria-label="Sections">
        {['Study', 'Browse', 'Progress', 'Tools'].map((label, i) => (
          <button key={label} type="button" className={`tabbar__tab${i === 0 ? ' tabbar__tab--active' : ''}`}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="tabbar__icon" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
