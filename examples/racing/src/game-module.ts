import Phaser from 'phaser';
import type { GameController, GameModule, GameModuleHooks } from '@playground/game-core';
import { attachAutoResize, computeGameSize, ReadyScene, type GameControls } from '@kapsel/shared';
import { RACE } from './constants';
import { RaceSeries } from './race-series';
import { t } from './i18n/strings';
import { MenuScene } from './scenes/menu-scene';
import { RaceScene } from './scenes/race-scene';
import { LeaderboardScene } from './scenes/leaderboard-scene';

/**
 * The only game in the catalogue that steers by rotation rather than tilt — the
 * capsule is held like a wheel and rolled (`motion.faceRoll`), which is why the
 * ready screen has to be told rather than assuming tilt.
 */
// Getters, not strings: this object is built when the module is first imported
// and the ready screen is drawn again on every launch.
const CONTROLS: GameControls = {
  steer: {
    method: 'rotate',
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

const racing: GameModule = {
  key: 'racing',
  title: 'Racing',
  description: 'Steer with the wheel, tilt to accelerate. Up to 4 players, 5 tracks.',
  minPlayers: 1,
  maxPlayers: RACE.MAX_PLAYERS,
  orientation: 'portrait',

  mount(parent: HTMLElement, players: GameController[], hooks?: GameModuleHooks): Phaser.Game {
    const { width, height } = computeGameSize(parent, 'portrait');
    // Hard-cap at 4 even if the hub roster allows more.
    const racers = players.slice(0, RACE.MAX_PLAYERS);
    const series = new RaceSeries(racers);
    const onExit = () => hooks?.onExit?.();

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
        // Collider debug off; toggle it in a race with the 'D' key.
        matter: { gravity: { x: 0, y: 0 }, debug: false },
      },
      // Menu → Ready (calibrate once) → Race → Results (Continue loops back to Race).
      scene: [
        new MenuScene(series, onExit),
        new ReadyScene(racers, 'Race', CONTROLS),
        new RaceScene(series, racers, onExit),
        new LeaderboardScene(series, onExit),
      ],
    });

    // Keeps the logical canvas matched to the viewport aspect so UiRoot re-lays
    // out; detaches itself when the game is destroyed.
    attachAutoResize(game, parent, 'portrait');
    return game;
  },
};

export default racing;
