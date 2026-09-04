import { describe, expect, it } from 'vitest';
import {
  HOME_NODE_ID,
  NAV_ROOT,
  hashFor,
  isLeaf,
  leavesUnder,
  nodeFromHash,
  parentOf,
  pathTo,
  type NavNode,
  type ScreenId,
} from './navigation';

/**
 * The tree is the menu *and* the map, so a screen that is not in it does not
 * exist as far as the app is concerned — there is no route to type and no menu
 * entry to press. Adding one means touching the `ScreenId` union, this tree and
 * the shell's renderer, and the compiler only catches the third.
 */

function walk(node: NavNode = NAV_ROOT): NavNode[] {
  return [node, ...(node.children ?? []).flatMap((child) => walk(child))];
}

const nodes = walk();
const leaves = nodes.filter(isLeaf);

/**
 * Every member of the union, written out.
 *
 * Deliberately a literal rather than derived from the tree: derived, it would
 * agree with the tree by construction and prove nothing. `satisfies` makes the
 * compiler complain if the union gains a member and this does not.
 */
const EVERY_SCREEN = [
  'practice',
  'practice-silent',
  'vocab-reading',
  'kanji-writing',
  'fill-in',
  'audio',
  'browse',
  'progress',
  'input',
  'scheduler',
  'account',
  'about',
] as const satisfies readonly ScreenId[];

describe('the navigation tree', () => {
  it('has somewhere to reach every screen from', () => {
    // A ScreenId with no node is a screen nobody can open, and nothing fails.
    const reachable = new Set(leaves.map((leaf) => leaf.screen));
    expect([...EVERY_SCREEN].filter((screen) => !reachable.has(screen))).toEqual([]);
  });

  it('shows each screen in one place', () => {
    // Two entries for one screen is two menu items that do the same thing, and
    // a breadcrumb that cannot say which one you came through.
    const screens = leaves.map((leaf) => leaf.screen);
    expect(new Set(screens).size).toBe(screens.length);
  });

  it('gives every node an id nothing else uses', () => {
    const ids = nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('makes every node a leaf or a branch, never both and never neither', () => {
    for (const node of nodes) {
      if (node.id === NAV_ROOT.id) continue;
      const branch = (node.children?.length ?? 0) > 0;
      expect(isLeaf(node) !== branch, node.id).toBe(true);
    }
  });

  it('survives a round trip through the address bar', () => {
    // The hash is the location: back, reload and the installed app reopening
    // all go through this.
    for (const node of nodes) {
      if (node.id === NAV_ROOT.id) continue;
      expect(nodeFromHash(hashFor(node.id)).id, node.id).toBe(node.id);
    }
  });

  it('lands somewhere real for a hash that means nothing', () => {
    for (const hash of ['', '#', '#/', '#/nonsense', '#/study.nope', '#//']) {
      expect(nodes.some((node) => node.id === nodeFromHash(hash).id)).toBe(true);
    }
  });

  it('opens on a screen rather than a menu', () => {
    // Opening the app *is* starting to study; a menu here is a decision asked
    // of someone with three minutes on a platform.
    const home = nodeFromHash(hashFor(HOME_NODE_ID));
    expect(home.id).toBe(HOME_NODE_ID);
    expect(isLeaf(home)).toBe(true);
  });

  it('gives everything below the root a way back up', () => {
    for (const node of nodes) {
      if (node.id === NAV_ROOT.id) continue;
      expect(parentOf(node.id), node.id).not.toBeNull();
      expect(pathTo(node.id)?.[0]?.id).toBe(NAV_ROOT.id);
    }
  });

  it('counts the same leaves however they are gathered', () => {
    expect(leavesUnder(NAV_ROOT).map((leaf) => leaf.id).sort()).toEqual(
      leaves.map((leaf) => leaf.id).sort(),
    );
  });
});
