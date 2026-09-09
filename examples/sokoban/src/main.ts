/**
 * Standalone dev harness: runs the game outside the hub with TWO keyboard
 * players, so the co-op boards are playable on a laptop where nobody has two
 * capsules. `npm run dev -w @kapsel/sokoban`.
 *
 *   P1  arrows, space to undo      P2  W A S D, Q to undo
 *
 * In production the hub mounts the module and provides the roster.
 */
import { KEYBOARD_PROFILES, WindowKeyboardController, loadFonts } from '@kapsel/shared';
import sokoban from './game-module';

async function main(): Promise<void> {
  await loadFonts();

  const players = KEYBOARD_PROFILES.slice(0, 2).map((keys) => new WindowKeyboardController(keys));
  if (players.length < 2) throw new Error('sokoban: shared has fewer than two keyboard profiles');

  const game = sokoban.mount(document.getElementById('game')!, players, {
    onExit: () => {
      // No hub to return to — just restart the module for quick iteration.
      game.destroy(true);
      location.reload();
    },
  });
}

void main();
