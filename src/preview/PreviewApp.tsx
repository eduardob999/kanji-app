import { useEffect, useState } from 'react';
import { AboutPanel } from '../components/AboutPanel';
import { AccountPanel } from '../components/AccountPanel';
import { BrowsePanel } from '../components/BrowsePanel';
import { InputMethodPanel } from '../components/InputMethodPanel';
import { ProgressPanel } from '../components/ProgressPanel';
import { SchedulerPanel } from '../components/SchedulerPanel';
import { SignInScreen } from '../components/SignInScreen';
import { AudioPanel } from '../quizzes/AudioPanel';
import { FillInPanel } from '../quizzes/FillInPanel';
import { KanjiWritingPanel } from '../quizzes/KanjiWritingPanel';
import { RandomPanel } from '../quizzes/RandomPanel';
import { TodaySessionPanel } from '../quizzes/TodaySessionPanel';
import { VocabReadingPanel } from '../quizzes/VocabReadingPanel';
import { previewUser } from './fixtures';

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
