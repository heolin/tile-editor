/**
 * Standalone dev harness: runs the racer outside the hub with four keyboard
 * players so the whole flow (menu → calibrate → countdown → race → leaderboard)
 * can be exercised without capsules. `npm run dev` in this folder.
 *
 * Keyboard players share one keyboard here (arrows/WASD steer, Space = button);
 * enough to prove the multi-race loop and standings.
 */
import type Phaser from 'phaser';
import { loadFonts, WindowKeyboardController } from '@kapsel/shared';
import racing from './game-module';

async function main(): Promise<void> {
  await loadFonts();

  const players = [
    new WindowKeyboardController(),
    new WindowKeyboardController(),
    new WindowKeyboardController(),
    new WindowKeyboardController(),
  ];
  const game = racing.mount(document.getElementById('game')!, players, {
    onExit: () => {
      game.destroy(true);
      location.reload();
    },
  });

  (window as unknown as { __racingGame: Phaser.Game }).__racingGame = game;
}

void main();
