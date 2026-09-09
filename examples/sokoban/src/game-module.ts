import Phaser from 'phaser';
import type { GameController, GameModule, GameModuleHooks } from '@playground/game-core';
import { ReadyScene, attachAutoResize, computeGameSize, type GameControls } from '@kapsel/shared';
import { SessionRef } from './session';
import { HudScene } from './scenes/hud-scene';
import { PlayScene } from './scenes/play-scene';
import { ResultsScene } from './scenes/results-scene';
import { SetupScene } from './scenes/setup-scene';
import { t } from './i18n/strings';

/**
 * Tilt steps the player one square at a time; the button takes a move back.
 * Both are worth saying on the ready screen — a board where a lean walks you
 * into a corner is a board you undo, and nothing else on screen says so.
 */
const CONTROLS: GameControls = {
  // Getters, not strings: this object is built when the module is first
  // imported and the ready screen is drawn again on every launch.
  steer: {
    method: 'tilt',
    get text() {
      return t('controls.steer');
    },
  },
  action: {
    get text() {
      return t('controls.action');
    },
  },
};

/**
 * Two seats, because the co-op boards are drawn for two people on one screen
 * with a controller each. A story board is one player's, and a second
 * controller there simply drives the same character.
 */
const MAX_PLAYERS = 2;

const sokoban: GameModule = {
  key: 'sokoban',
  title: 'Box Depot',
  description: 'Push every crate onto its mark. Colours must match, and a pit keeps what falls in. Co-op boards for two.',
  minPlayers: 1,
  maxPlayers: MAX_PLAYERS,
  orientation: 'portrait',

  mount(parent: HTMLElement, players: GameController[], hooks?: GameModuleHooks): Phaser.Game {
    const { width, height } = computeGameSize(parent, 'portrait');
    const seats = players.slice(0, MAX_PLAYERS);
    const onExit = () => hooks?.onExit?.();

    // Built before the scenes and shared by them: the picker fills it in, and
    // the results screen replaces it when the next board is chosen.
    const ref = new SessionRef();

    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent,
      backgroundColor: '#10141c',
      width,
      height,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      // No physics: the board is a grid and a move is one cell.
      scene: [
        new SetupScene(
          seats,
          ref,
          () => {
            // Stop before starting: `game.scene` is the manager, so start()
            // alone would leave Setup running underneath with its START button
            // still taking input. Every other game in the hub carries this note.
            game.scene.stop('Setup');
            game.scene.start('Ready');
          },
          onExit,
        ),
        new ReadyScene(seats, 'Play', CONTROLS),
        new PlayScene(seats, ref),
        new HudScene(ref, onExit),
        new ResultsScene(ref),
      ],
    });

    attachAutoResize(game, parent, 'portrait');
    return game;
  },
};

export default sokoban;
