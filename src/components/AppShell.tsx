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
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { AccountPanel } from './AccountPanel';
import { AppMark } from './AppMark';
import { BrowsePanel } from './BrowsePanel';
import { ComingSoon } from './ComingSoon';

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
  const online = useOnlineStatus();
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

      // ── Not built yet ────────────────────────────────────────────────────
      // Each of these is replaced by its panel in a later phase; the tree is
      // complete now so the shape of the app can be walked and checked.
      case 'today':
        return (
          <ComingSoon
            title="Today's Session"
            note="Everything due across the four modes, interleaved so you never get forty N1 kanji in a row."
          />
        );
      case 'vocab-reading':
        return (
          <ComingSoon
            title="Vocab reading"
            note="The word and its meaning; you supply the reading."
          />
        );
      case 'kanji-writing':
        return (
          <ComingSoon
            title="Kanji writing"
            note="Readings and meaning; you supply the character."
          />
        );
      case 'fill-in':
        return (
          <ComingSoon
            title="Fill in the blank"
            note="A real sentence from Tatoeba with the word taken out."
          />
        );
      case 'audio':
        return <ComingSoon title="Listening" note="Hear the word in context, then write it." />;
      case 'browse':
        return <BrowsePanel />;
      case 'progress':
        return (
          <ComingSoon
            title="Progress"
            note="How much of each level you hold, and whether the schedule is aimed correctly."
          />
        );
      case 'input':
        return (
          <ComingSoon
            title="Input method"
            note="Keyboard, handwriting, or multiple choice — switchable mid-session."
          />
        );
      case 'about':
        return (
          <ComingSoon
            title="About & credits"
            note="The data this app is built on, and the licences it ships under."
          />
        );
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
        {online ? null : (
          <span className="topbar__offline" title="Offline — everything still works">
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
