/**
 * Standalone dev harness: runs the game outside the hub with FOUR keyboard
 * players, so a crowded board is exercisable on a laptop where nobody has four
 * capsules. `npm run dev -w @kapsel/tilt-ball`.
 *
 *   P1  arrows      P2  W A S D      P3  I J K L      P4  numpad 8 4 5 6
 *
 * Steering is two-axis here, unlike most of the hub's games, so the two profiles
 * `shared` exposes are not enough on their own — they are one-axis maps. The two
 * extra ones live here rather than in `shared` because nothing else needs them.
 *
 * In production the hub mounts the module and provides the roster.
 */
import { KEYBOARD_PROFILES, WindowKeyboardController, loadFonts, type KeyMap } from '@kapsel/shared';
import tiltBall from './game-module';

const EXTRA: KeyMap[] = [
  { up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], action: ['KeyU'] },
  { up: ['Numpad8'], down: ['Numpad5'], left: ['Numpad4'], right: ['Numpad6'], action: ['Numpad0'] },
];

async function main(): Promise<void> {
  await loadFonts();

  const maps: KeyMap[] = [...KEYBOARD_PROFILES, ...EXTRA];
  const players = maps.map((keys) => new WindowKeyboardController(keys));

  const game = tiltBall.mount(document.getElementById('game')!, players, {
    onExit: () => {
      // No hub to return to — just restart the module for quick iteration.
      game.destroy(true);
      location.reload();
    },
  });
}

void main();
