import Phaser from 'phaser';
import type { GameController, GameModule, GameModuleHooks } from '@playground/game-core';
import {
  ReadyScene,
  attachAutoResize,
  computeGameSize,
  type GameControls,
} from '@kapsel/shared';
import { PHYSICS } from './constants';
import { RunState } from './run-state';
import { SessionRef } from './session';
import { HudScene } from './scenes/hud-scene';
import { t } from './i18n/strings';
import { PlayScene } from './scenes/play-scene';
import { ResultsScene } from './scenes/results-scene';
import { SetupScene } from './scenes/setup-scene';

/**
 * Tilt steers the ball directly; the button does nothing at all. Saying so on
 * the ready screen is better than leaving a player pressing it to find out —
 * this is the same call Hop Up made about its own idle button.
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

/** Four balls, four colours, one board. */
const MAX_PLAYERS = 4;

const tiltBall: GameModule = {
  key: 'tilt-ball',
  title: 'Tilt Ball',
  description: 'Tilt your ball into the goal without falling in. Up to 4 players on one board.',
  minPlayers: 1,
  maxPlayers: MAX_PLAYERS,
  orientation: 'portrait',

  mount(parent: HTMLElement, players: GameController[], hooks?: GameModuleHooks): Phaser.Game {
    const { width, height } = computeGameSize(parent, 'portrait');
    const seats = players.slice(0, MAX_PLAYERS);
    const onExit = () => hooks?.onExit?.();

    // Both are built before the scenes and shared by all of them: the session is
    // replaced whenever the setup screen runs again, and the run state survives
    // a story restart (which restarts the play scene under the HUD).
    const ref = new SessionRef();
    const run = new RunState();

    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent,
      backgroundColor: '#10141c',
      width,
      height,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        default: 'matter',
        matter: {
          // No gravity: the board is seen from above and the tilt is the only
          // force in the game.
          gravity: { x: 0, y: 0 },
          // A fixed 120 Hz step with room for two of them per frame, and solver
          // passes well above the defaults. Both are about the same two things:
          // a ball at 1100 px/s covers half its own radius per 60 Hz frame, and
          // a rotating block sweeps its far corner through the space a ball is
          // sitting in. See PHYSICS in constants.ts.
          runner: { fps: PHYSICS.stepHz, maxUpdates: 2 },
          positionIterations: PHYSICS.positionIterations,
          velocityIterations: PHYSICS.velocityIterations,
          constraintIterations: PHYSICS.constraintIterations,
          debug: false,
        },
      },
      // Setup → Ready → Play (+ Hud alongside) → Results, and Results goes back
      // to Play or to Setup. Ready is added here rather than later because the
      // roster is fixed before the setup screen runs — only WHAT is played is
      // decided there.
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
        new PlayScene(ref, run),
        new HudScene(ref, run, onExit),
        new ResultsScene(ref),
      ],
    });

    attachAutoResize(game, parent, 'portrait');
    return game;
  },
};

export default tiltBall;
