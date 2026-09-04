/**
 * The app's navigation tree.
 *
 * Pure data plus the walking logic — no React, no router dependency. A router
 * would be a reasonable choice for an app with URLs worth sharing; this one is
 * an installed PWA with a dozen screens, where a 40 kB dependency buys a
 * `<Link>` component and takes away the ability to say exactly what the tree is
 * in one file.
 *
 * The tree is the menu *and* the map: the shell renders a branch's children as
 * a menu, a leaf as its panel, and the path back out as breadcrumbs. Adding a
 * screen means adding a node here and a case in the shell's renderer, which is
 * the smallest number of places it can be.
 *
 * Carried over from GHAPP, whose version of this file earned its keep.
 */

/** Every leaf screen. The shell maps these to components. */
export type ScreenId =
  | 'practice'
  | 'practice-silent'
  | 'vocab-reading'
  | 'kanji-writing'
  | 'fill-in'
  | 'audio'
  | 'browse'
  | 'progress'
  | 'input'
  | 'scheduler'
  | 'account'
  | 'about';

export interface NavNode {
  id: string;
  title: string;
  /** One line under the title in a menu. */
  blurb?: string;
  /** Leaves have a screen; branches have children. */
  screen?: ScreenId;
  children?: readonly NavNode[];
  /**
   * Whether the screen needs a Japanese speech voice. The shell warns once, up
   * front, rather than each panel discovering separately that the device has
   * none installed.
   */
  needsSpeech?: boolean;
}

/**
 * The tree.
 *
 * Deliberately shallow, two levels below the root. The four quiz modes sit
 * beside Practice rather than under a "Quizzes" branch of their own, because
 * picking one deliberately is a thing people do often enough that it should
 * not cost two taps.
 *
 * Practice is the front door and used to be three doors: Today's Session, which
 * stopped as soon as the schedule was clear, and Random, which kept going but
 * paid the schedule no attention. They are one leaf now. Their old ids are
 * gone rather than aliased, which costs nothing, because `nodeFromHash` sends
 * anything it does not recognise home and home is the screen they became.
 */
export const NAV_ROOT: NavNode = {
  id: 'root',
  title: 'Kanjiba',
  children: [
    {
      id: 'study',
      title: 'Study',
      blurb: 'Let the schedule choose, or drill one kind of question.',
      children: [
        {
          id: 'study.practice',
          title: 'Practice',
          blurb: 'What is due, then new words at your pace, then as long as you want.',
          screen: 'practice',
          needsSpeech: true,
        },
        {
          id: 'study.practice-silent',
          title: 'Practice (silent)',
          blurb: 'The same, minus listening. For a bus, a library, or a shared room.',
          screen: 'practice-silent',
        },
        {
          id: 'study.vocab-reading',
          title: 'Vocab reading',
          blurb: 'The word and its meaning. You supply the reading.',
          screen: 'vocab-reading',
        },
        {
          id: 'study.kanji-writing',
          title: 'Kanji writing',
          blurb: 'Readings and meaning. You supply the character.',
          screen: 'kanji-writing',
        },
        {
          id: 'study.fill-in',
          title: 'Fill in the blank',
          blurb: 'A real sentence with the word taken out.',
          screen: 'fill-in',
        },
        {
          id: 'study.audio',
          title: 'Listening',
          blurb: 'Hear it, then write it.',
          screen: 'audio',
          needsSpeech: true,
        },
      ],
    },
    {
      // A section with one child is a menu that exists to be tapped through, so
      // this one is the screen itself. The tab goes straight there.
      id: 'browse',
      title: 'Browse',
      blurb: 'Every kanji and word, by JLPT level, with its schedule.',
      screen: 'browse',
    },
    {
      id: 'progress',
      title: 'Progress',
      blurb: 'How much of each level you hold, and how well the schedule is aimed.',
      screen: 'progress',
    },
    {
      id: 'tools',
      title: 'Tools',
      blurb: 'How you answer, where it is stored, and who to credit.',
      children: [
        {
          id: 'tools.input',
          title: 'Input method',
          blurb: 'Keyboard, handwriting, or multiple choice.',
          screen: 'input',
        },
        {
          id: 'tools.scheduler',
          title: 'Scheduler',
          blurb: 'How well aimed your intervals are, and what has been fitted to you.',
          screen: 'scheduler',
        },
        {
          id: 'tools.account',
          title: 'Account & sync',
          blurb: 'Where your progress is stored, and whether it has landed.',
          screen: 'account',
        },
        {
          id: 'tools.about',
          title: 'About & credits',
          blurb: 'The data this app is built on, and its licences.',
          screen: 'about',
        },
      ],
    },
  ],
};

/**
 * The node the app opens on.
 *
 * Opening the app *is* starting to study. A home screen here would be a
 * decision asked of someone who has three minutes on a train platform.
 */
export const HOME_NODE_ID = 'study.practice';

/**
 * The path from the root to a node, root first, or null when there is no such
 * node. This is the breadcrumb, the back stack and the "where am I" all at
 * once — deriving them from one walk means they cannot disagree.
 */
export function pathTo(id: string, from: NavNode = NAV_ROOT): NavNode[] | null {
  if (from.id === id) return [from];

  for (const child of from.children ?? []) {
    const below = pathTo(id, child);
    if (below) return [from, ...below];
  }

  return null;
}

export function findNode(id: string, from: NavNode = NAV_ROOT): NavNode | null {
  return pathTo(id, from)?.at(-1) ?? null;
}

/** The node one level up, or null at the root. */
export function parentOf(id: string): NavNode | null {
  const path = pathTo(id);
  return path && path.length >= 2 ? path[path.length - 2]! : null;
}

export function isLeaf(node: NavNode): boolean {
  return node.screen !== undefined;
}

/** Every leaf under a node, depth first. Used for search and for tests. */
export function leavesUnder(node: NavNode): NavNode[] {
  if (isLeaf(node)) return [node];
  return (node.children ?? []).flatMap(leavesUnder);
}

/**
 * The location, as it appears in `location.hash`.
 *
 * Hash rather than a path because the app is served from a project page under
 * a sub-path — a real path would need the server to rewrite unknown paths to
 * index.html, and GitHub Pages will not. The hash survives a reload, a share,
 * and the installed PWA restoring its last screen.
 */
export function hashFor(id: string): string {
  return `#/${id === HOME_NODE_ID ? '' : id}`;
}

/** The node a hash refers to, falling back to home for anything unrecognised. */
export function nodeFromHash(hash: string): NavNode {
  const id = hash.replace(/^#\/?/, '').trim();
  if (!id) return findNode(HOME_NODE_ID)!;
  return findNode(id) ?? findNode(HOME_NODE_ID)!;
}
