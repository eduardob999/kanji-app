import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  HOME_NODE_ID,
  NAV_ROOT,
  hashFor,
  isLeaf,
  nodeFromHash,
  parentOf,
  pathTo,
  type NavNode,
  type ScreenId,
} from '../domain/navigation';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useModelFit } from '../hooks/useModelFit';
import { useUserProfile } from '../hooks/useUserProfile';
import { EMPTY_MODEL } from '../storage/modelState';
import { AccountPanel } from './AccountPanel';
import { AppMark } from './AppMark';
import { BrowsePanel } from './BrowsePanel';
import { AboutPanel } from './AboutPanel';
import { SchedulerPanel } from './SchedulerPanel';
import { ProgressPanel } from './ProgressPanel';
import { InputMethodPanel } from './InputMethodPanel';
import { KanjiWritingPanel } from '../quizzes/KanjiWritingPanel';
import { FillInPanel } from '../quizzes/FillInPanel';
import { AudioPanel } from '../quizzes/AudioPanel';
import { PracticePanel } from '../quizzes/PracticePanel';
import { VocabReadingPanel } from '../quizzes/VocabReadingPanel';

/**
 * The app shell: one screen at a time, and the way between them.
 *
 * The rules here are small, and carried over from GHAPP:
 *
 * - **One screen at a time.** A leaf renders its panel and nothing else.
 * - **The tree is the menu.** Branches render their children; there is no
 *   separate navigation list to keep in step with the tree.
 * - **The hash is the location.** Back, reload and the installed PWA reopening
 *   all land where you were, and nothing needs a router to do it.
 */

interface AppShellProps {
  user: User;
}

export function AppShell({ user }: AppShellProps) {
  const sync = useSyncStatus(user);
  const { profile } = useUserProfile(user);

  // Retunes the memory model to this learner once enough new answers have
  // built up, in idle time after the app has settled. Mounted here so it runs
  // once per launch rather than once per screen that happens to want it.
  useModelFit(user, profile?.kanjiba.adaptive ?? EMPTY_MODEL);
  const [nodeId, setNodeId] = useState<string>(() => nodeFromHash(window.location.hash).id);

  const go = useCallback((id: string) => {
    setNodeId(id);
    // pushState rather than assigning location.hash, so the browser back button
    // walks the history we actually created.
    window.history.pushState(null, '', hashFor(id));
  }, []);

  // The browser's own back button, and anyone editing the hash by hand.
  useEffect(() => {
    const onPop = () => setNodeId(nodeFromHash(window.location.hash).id);
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  const node = nodeFromHash(hashFor(nodeId));
  // Drop the root, the parent (the back link already names it) and the node
  // itself (the "here" crumb does). What is left is the middle of a deep tree —
  // empty today, and correct when the tree grows.
  const trail = pathTo(node.id)?.slice(1, -2) ?? [];
  // No back link out of a section: the tab bar already holds every section, and
  // a breadcrumb whose only destination is "the list of things in the tab bar"
  // is a rung on a ladder to nowhere.
  const up = parentOf(node.id);
  const parent = up && up.id !== 'root' ? up : null;

  function renderScreen(screen: ScreenId) {
    switch (screen) {
      case 'account':
        return <AccountPanel user={user} />;
      case 'scheduler':
        return <SchedulerPanel user={user} />;

      // ── Not built yet ────────────────────────────────────────────────────
      // Each of these is replaced by its panel in a later phase; the tree is
      // complete now so the shape of the app can be walked and checked.
      case 'practice':
        return <PracticePanel user={user} />;
      case 'practice-silent':
        return <PracticePanel user={user} silent />;
      case 'vocab-reading':
        return <VocabReadingPanel user={user} />;
      case 'kanji-writing':
        return <KanjiWritingPanel user={user} />;
      case 'fill-in':
        return <FillInPanel user={user} />;
      case 'audio':
        return <AudioPanel user={user} />;
      case 'browse':
        return <BrowsePanel user={user} />;
      case 'progress':
        return <ProgressPanel user={user} />;
      case 'input':
        return <InputMethodPanel user={user} />;
      case 'about':
        return <AboutPanel />;
    }
  }

  return (
    <div className="screen">
      <a className="skiplink" href="#main">
        Skip to the questions
      </a>

      <header className="topbar">
        <button
          type="button"
          className="topbar__home"
          onClick={() => go(HOME_NODE_ID)}
          aria-label="Home"
        >
          <AppMark size={28} />
        </button>
        {isLeaf(node) ? (
          <h1 className="topbar__where">{node.title}</h1>
        ) : (
          <span className="topbar__where topbar__where--muted" aria-hidden="true">
            {node.title}
          </span>
        )}
        {/*
          Silent when there is nothing to say.
          
          "Saving" outranks "offline" because it is the one that answers the
          question someone actually has mid-session — whether the answer they
          just gave is safe. Being offline is only alarming if something is
          waiting, and the badge that reports that is the one to show.
        */}
        {sync.hasPendingWrites ? (
          <span
            className="topbar__status topbar__status--pending"
            title="Answered offline, or waiting on the server. Nothing is lost — it sends when it can."
          >
            saving
          </span>
        ) : sync.online ? null : (
          <span className="topbar__status" title="Offline — everything still works">
            offline
          </span>
        )}
      </header>

      <nav className={`crumbs${parent ? '' : ' crumbs--hidden'}`} aria-label="Breadcrumb">
        {parent ? (
          <button type="button" className="crumbs__back" onClick={() => go(parent.id)}>
            ← {parent.title}
          </button>
        ) : null}

        {trail.map((crumb) => (
          <button
            key={crumb.id}
            type="button"
            className="crumbs__crumb"
            onClick={() => go(crumb.id)}
          >
            {crumb.title}
          </button>
        ))}
        <span className="crumbs__here" data-testid="crumb-here">
          {node.title}
        </span>
      </nav>

      <main className="content" id="main" tabIndex={-1} data-node={node.id}>
        {isLeaf(node) ? (
          renderScreen(node.screen!)
        ) : (
          <>
            <header className="section-head">
              <p className="section-head__eyebrow">Three minutes on the platform</p>
              <h1 className="section-head__title">{node.title}</h1>
            </header>
            {node.blurb ? <p className="menu__lead">{node.blurb}</p> : null}
            <ul className="menu" data-testid="menu">
              {(node.children ?? []).map((child: NavNode) => (
                <li key={child.id}>
                  <button
                    type="button"
                    className="menu__item"
                    onClick={() => go(child.id)}
                    data-nav={child.id}
                  >
                    <span className="menu__title">{child.title}</span>
                    {child.blurb ? <span className="menu__blurb">{child.blurb}</span> : null}
                    <span className="menu__chevron" aria-hidden="true">
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {/* The root sections, always one tap away from anywhere. */}
      <nav className="tabbar" aria-label="Sections">
        {SECTIONS.map((section) => {
          const active = node.id === section.id || node.id.startsWith(`${section.id}.`);
          return (
            <button
              key={section.id}
              type="button"
              className={`tabbar__tab${active ? ' tabbar__tab--active' : ''}`}
              onClick={() => go(section.id)}
              aria-current={active ? 'page' : undefined}
              data-tab={section.id}
            >
              <TabIcon section={section.id} />
              {section.title}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Tab icons, drawn rather than shipped.
 *
 * Inline SVG so they render from the service worker cache like everything else,
 * and so they take `currentColor` from the active state instead of needing two
 * files each.
 */
function TabIcon({ section }: { section: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    'aria-hidden': true,
    className: 'tabbar__icon',
  } as const;

  switch (section) {
    // A writing frame, as on the icon.
    case 'study':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 11h8M12 7.5v9" strokeLinecap="round" />
        </svg>
      );
    // Stacked cards.
    case 'browse':
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      );
    case 'progress':
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M6 15v4M12 10v9M18 6v13" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      );
  }
}

/**
 * The root sections, in tab-bar order.
 *
 * Derived from the tree rather than listed again: a tab bar that can disagree
 * with the menu it navigates is a tab bar that eventually does.
 */
const SECTIONS = NAV_ROOT.children ?? [];
