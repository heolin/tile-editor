import Phaser from 'phaser';
import type { GameController } from '@playground/game-core';
import {
  FONT,
  generateUiTextures,
  loadImages,
  music,
  PauseMenu,
  playerColor,
  powerupDef,
  preloadSounds,
  runCountdown,
  sfx,
  TYPE,
  vfx,
  ui,
  uiFont,
  type FxHandle,
  type SfxHandle,
} from '@kapsel/shared';
import { CAR, CAMERA, DEPTH, RACE, REWIND, TILE } from '../constants';
import { PowerupManager, type PowerupHost } from '../powerups/manager';
// Side-effect import: registers this game's `rc-*` sound pack.
import '../sounds';
// Side-effect import: registers this game's `rc-*` effect pack.
import '../fx';
import type { RaceSeries } from '../race-series';
import { carKey, getTrackMap, getTrackPath, preloadTextures } from '../track/track-assets';
import { loadTrack } from '../track/tiled-track-loader';
import { buildObjectBodies, buildWallsPerTile } from '../collision/collision-loader';
import type { LoadedTrack } from '../track/types';
import { Car } from '../entities/car';
import { CarInput, type CarControl } from '../input/car-input';
import { analyzeTrack, type TrackAnalysis } from '../race/track-analyzer';
import { t } from '../i18n/strings';
import { RaceManager } from '../race/race-manager';
import { RacingLine } from '../race/racing-line';
import { SteeringAssist } from '../race/steering-assist';

/**
 * Bottom-left tuning readout (wheel angle, throttle, per-car lap / progress /
 * line offset / assist nudge). Off for play; set true when tuning the input,
 * the steering assist or the rewind.
 */
const SHOW_DEBUG_TEXT = false;

/**
 * Engine loop playback rate at a standstill and at full speed. Rate doubles as
 * pitch for a buffer source, so this IS the rev range — the placeholder loop is
 * a 90 Hz tone, giving roughly 65 Hz idling to 200 Hz flat out.
 */
const IDLE_RATE = 0.72;
const REDLINE_RATE = 2.2;
/** Loudest an engine gets, leaving room for four of them plus the music. */
const ENGINE_VOLUME = 0.34;

/**
 * Speed lost to a wall in one frame, in px/s, above which it is a crash worth
 * hearing rather than a scrape along a barrier.
 */
const CRASH_THRESHOLD = 90;

/** Cornering intensity (steer × speed fraction) at which the tyres are at full. */
const SKID_FULL = 0.55;
/** Per-second approach rate of the skid's smoothing. Fast in, slower out. */
const SKID_RISE = 9;
const SKID_FALL = 4;

/**
 * Dust rises at cruise even with the wheel straight; this is how much of full
 * intensity a flat-out car in a straight line gets.
 *
 * Tuned against the speed a car REACHES, not `CAR.MAX_SPEED`. That constant is a
 * clamp — drag balances acceleration at roughly 249px/s — so `speed / MAX_SPEED`
 * tops out near 0.42 and never approaches 1. Read as a fraction of full lock this
 * looks enormous; in practice it is one particle every ~90ms on a straight, and
 * anything much lower rounds the quantity to zero and shows nothing at all.
 */
const DUST_CRUISE = 0.5;
/** Where the plume sits behind the car's centre, as a fraction of its length. */
const DUST_BACK_FRAC = 0.45;
/**
 * Speed band the dust fades in over, in ABSOLUTE px/s — silent below FROM, full
 * weight from TO up.
 *
 * Absolute rather than a fraction of `CAR.MAX_SPEED`, for the reason
 * `constants.ts` spells out: that constant is a clamp the car never reaches
 * (drag balances acceleration at ~249px/s), so anything tuned as a fraction of
 * it acts far weaker than it reads. Same shape as `ASSIST.FADE_FROM`/`FADE_TO`,
 * which exist for exactly this reason.
 *
 * This gates the CORNERING term as well as the cruise one, which is the point: a
 * car inching along with the wheel hard over was throwing up a plume, because
 * cornering intensity only asks how much lock is on relative to speed, and at a
 * crawl that ratio is easy to max out.
 */
const DUST_FADE_FROM = 70;
const DUST_FADE_TO = 180;

/**
 * The cornering smoke's own speed band, in absolute px/s — much higher than the
 * trail's, because it means something different. A trail says "moving"; tyre
 * smoke says "carrying more speed into this than the tyres want", and that should
 * not happen at half pace. Full-throttle cruise is about 249px/s, so this opens
 * up over roughly the top third of the car's real range.
 */
const SLIDE_FADE_FROM = 150;
const SLIDE_FADE_TO = 220;
/**
 * Steering lock at which the smoke is at full weight.
 *
 * Lock ALONE, deliberately unlike the skid's cornering measure, which scales lock
 * by speed. The speed band above is already the whole of this plume's speed
 * dependence, and multiplying the two together counted it twice: each factor sits
 * well under 1 even when the car is flat out on full lock, so the product landed
 * near the floor and the quantity ramp rounded it away to nothing.
 */
const SLIDE_LOCK_FULL = 0.6;

/**
 * The skid's asymmetric, frame-rate-independent approach: quick to build, slower
 * to let go. Shared by both plumes so they rise and fall on the same curve the
 * tyre noise does.
 */
function approach(level: number, target: number, dt: number): number {
  const rate = target > level ? SKID_RISE : SKID_FALL;
  return level + (target - level) * Math.min(1, rate * dt);
}
/**
 * Half-width of the dust's fan, in degrees either side of straight-back.
 *
 * Applied as per-frame jitter rather than baked into the definition as an angle
 * range, because the aim has to rotate with the car and Phaser can only move a
 * single-value angle — see the note in `fx.ts`. Particles emitted on the same
 * frame share an angle; across frames they spread.
 */
const DUST_SPREAD_DEG = 18;

/**
 * Runs one race under a portrait fit-to-track world camera (+ a UI camera for
 * HUD/pause/countdown). Spawns are auto-derived from the start tile (two-column
 * random grid); laps are counted by loop progress; the race ends at 60s or when
 * everyone finishes.
 */
export class RaceScene extends Phaser.Scene implements PowerupHost {
  private track!: LoadedTrack;
  private analysis!: TrackAnalysis;
  private manager!: RaceManager;
  /** Public because this scene is the `PowerupHost`; nothing else reads it. */
  cars: Car[] = [];
  private inputs: CarInput[] = [];
  private powerups!: PowerupManager;
  /** The powerup announcement over the HUD, reused rather than recreated. */
  private toastText!: Phaser.GameObjects.Text;
  private lapLabels: Phaser.GameObjects.Text[] = [];
  private racing = false;
  private infoText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private timerBarMaxW = 0;
  private dbgText!: Phaser.GameObjects.Text;
  private raceEndsAt = 0;
  private raceDurationMs = 0;
  private debug?: Phaser.GameObjects.Graphics;
  private lineMarker?: Phaser.GameObjects.Graphics;
  private racingLine: RacingLine | null = null;
  private assist!: SteeringAssist;
  /** Per-car nearest-point index on the racing line (search hint, carried over). */
  private lineIndex: number[] = [];
  /** Per-car assist aim point + last nudge, for the debug overlay. */
  private assistDebug: ({ x: number; y: number } | null)[] = [];
  private assistNudge: number[] = [];
  private rewindAt: number[] = [];
  /**
   * Progress in LAPS along the racing line, accumulated rather than read modulo
   * the loop: 0 is the finish line at the gun (so the grid, which sits behind it,
   * starts slightly negative) and 1.03 means 3% into lap two. `best` only ever
   * grows, and it is what the rewind measures back from.
   */
  private progress: number[] = [];
  private bestProgress: number[] = [];

  /**
   * One held voice per car, rate-tracking its speed, plus a single shared tyre
   * loop. Per-car engines because four cars at four speeds is the sound of the
   * race; ONE skid because it is one screen with one speaker, and four scrub
   * loops summing is just noise with no extra information in it.
   */
  private engines: SfxHandle[] = [];
  private skid: SfxHandle | null = null;
  /**
   * Two plumes per car, both positioned and driven from `updateDust`.
   *
   * `dust` is the trail every rolling car leaves, off the back and driven by
   * speed alone. `slide` is cornering smoke: bigger, off the outer flank, and
   * driven by steering lock. They are separate emitters rather than one because
   * they differ in every respect that a definition owns — size, lifespan, where
   * they come from and which way they are thrown.
   */
  private dust: FxHandle[] = [];
  private slide: FxHandle[] = [];
  /**
   * Smoothed intensities, per car. Per-car rather than one shared level like the
   * skid, because dust is drawn where a specific car is: one screen has one
   * speaker but four sets of tyres.
   */
  private dustLevel: number[] = [];
  private slideLevel: number[] = [];
  /** Smoothed cornering intensity behind the skid's volume, 0..1. */
  private skidLevel = 0;
  /** Last lap count and finished flag per car, for sounding the transitions. */
  private lastLap: number[] = [];
  private lastFinished: boolean[] = [];

  constructor(
    private series: RaceSeries,
    private players: GameController[],
    private onExit: () => void,
  ) {
    super('Race');
  }

  preload(): void {
    loadImages(this);
    preloadTextures(this);
  }

  create(): void {
    generateUiTextures(this);
    this.cars = [];
    this.inputs = [];
    this.lapLabels = [];
    this.racing = false;
    this.cameras.main.setBackgroundColor('#0b1017');

    const trackId = this.series.currentTrack();
    const map = getTrackMap(trackId + 1);
    this.track = loadTrack(this, map);
    const path = getTrackPath(trackId + 1);
    this.racingLine = path ? new RacingLine(path) : null;
    // The line (points[0] sits on the finish line) decides which way round the
    // circuit goes, so spawns, the finish gate and the rewind can't disagree.
    this.analysis = analyzeTrack(map, this.racingLine?.sample(0).headingRad);
    this.assist = new SteeringAssist(this.racingLine, this.series.difficulty);
    this.lineIndex = [];
    this.assistDebug = [];
    this.assistNudge = [];
    this.rewindAt = [];
    this.progress = [];
    this.bestProgress = [];
    this.engines = [];
    this.skid = null;
    this.skidLevel = 0;
    // The handles themselves die with the scene, but this instance survives a
    // `scene.restart()` and must not carry dead ones into the next race.
    this.dust = [];
    this.slide = [];
    this.dustLevel = [];
    this.slideLevel = [];
    this.lastLap = [];
    this.lastFinished = [];

    // Every registered key, and early: the countdown gives the decode a couple
    // of seconds before `beginRace` asks for the held voices, which unlike a
    // one-shot cannot simply be dropped and retried. Not just this game's keys —
    // standalone dev runs the race with no hub to have warmed the shared set.
    void preloadSounds();
    music.play('rc-theme');

    // Per-tile walls (one collider set per road tile — no map merging) + solid
    // object bodies, plus a world-bounds safety net at the very edge.
    buildWallsPerTile(this, this.track.trackLayer);
    buildObjectBodies(this, this.track.solidObjects);
    this.matter.world.setBounds(0, 0, this.track.worldWidth, this.track.worldHeight);

    this.spawnCars();
    this.manager = new RaceManager(this.analysis, this.series.laps, this.cars.length);
    this.buildHud(trackId);
    this.buildDebug();
    this.setupCameras();
    // After setupCameras, deliberately: every sprite it creates from here on has
    // to opt out of the UI camera by hand, which is what `adopt` is for.
    this.powerups = new PowerupManager(this, this, this.racingLine);

    // CarInput listens on the controllers, which outlive the scene (every race
    // builds a fresh set), so hand the listeners back when the scene goes away.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const input of this.inputs) input.destroy();
      // Held voices outlive the scene unless someone stops them — `sfx`'s `loop`
      // option says as much. Leaving the race with four engines still running
      // would follow the player back to the lobby.
      this.stopLoops();
      this.powerups.destroy();
    });

    new PauseMenu(this, { onExit: () => this.onExit(), cameraIgnore: this.cameras.main });
    runCountdown(this, {
      x: this.track.worldWidth / 2,
      y: this.track.worldHeight / 2,
      cameraIgnore: this.cameras.main,
      onDone: () => this.beginRace(),
    });

    // 'D' toggles the collider debug (created on demand) + the analyzer overlay.
    this.input.keyboard?.on('keydown-D', () => {
      const world = this.matter.world;
      const on = !world.drawDebug;
      world.drawDebug = on;
      this.debug?.setVisible(on);
      this.lineMarker?.setVisible(on).clear();
      if (on) {
        let g = world.debugGraphic;
        if (!g) {
          g = world.createDebugGraphic();
          g.setDepth(DEPTH.debug);
          this.cameras.getCamera('ui')?.ignore(g);
        }
        g.setVisible(true);
      } else {
        world.debugGraphic?.clear();
      }
    });
  }

  update(_time: number, delta: number): void {
    if (!this.racing) return;
    const dt = delta / 1000;
    // Project onto the line first: both the assist and the rewind work off it.
    this.updateLineTracking();
    const controls = this.inputs.map((input) => input.sample());
    for (let i = 0; i < this.cars.length; i++) {
      if (controls[i].rewind) this.rewindCar(i);
    }
    this.updateAssist(dt, controls);
    for (let i = 0; i < this.cars.length; i++) {
      this.cars[i].update(dt, controls[i], this.assistNudge[i] ?? 0);
    }
    // After the cars have moved, so a pickup is collected where the car actually
    // is this frame rather than where it was last one.
    this.powerups.update(dt);
    this.manager.update(this.time.now, this.cars);
    this.updateAudio(dt, controls);
    this.updateDust(dt, controls);
    this.updateLapLabels();
    this.updateDebug();
    this.drawLineMarkers();

    const left = Math.max(0, this.raceEndsAt - this.time.now);
    const urgent = left <= 10_000;
    this.clockText.setText(this.formatClock(left)).setColor(urgent ? '#ff5757' : '#ffd166');
    this.timerBar.width = (left / this.raceDurationMs) * this.timerBarMaxW;
    this.timerBar.fillColor = urgent ? 0xff5757 : 0x51d88a;
    if (left <= 0 || this.manager.allFinished()) this.endRace();
  }

  private beginRace(): void {
    this.racing = true;
    this.raceDurationMs = this.series.laps * RACE.LAP_MS;
    this.raceEndsAt = this.time.now + this.raceDurationMs;
    this.manager.start(this.time.now, this.cars);

    // Started on the gun, not in create(): the engines are silent through the
    // countdown, which is what makes the gun mean something.
    this.engines = this.cars.map(() =>
      sfx('rc-engine', { volume: 0, rate: IDLE_RATE, loop: true }),
    );
    this.skid = sfx('rc-skid', { volume: 0, loop: true });
    // Started on the gun too: a plume under a car on the grid would read as a
    // burnout nobody asked for.
    //
    // The UI camera's ignore list is built in `setupCameras`, during create, so
    // anything added later has to opt out by hand or it is drawn a second time
    // at unscrolled screen coordinates. Same treatment the debug graphics get.
    const uiCam = this.cameras.getCamera('ui');
    const plume = (key: string): FxHandle => {
      const handle = vfx(this, key, { depth: DEPTH.objLow, intensity: 0 });
      if (handle.emitter) uiCam?.ignore(handle.emitter);
      return handle;
    };
    this.dust = this.cars.map(() => plume('rc-dust'));
    this.slide = this.cars.map(() => plume('rc-slide'));
    this.dustLevel = this.cars.map(() => 0);
    this.slideLevel = this.cars.map(() => 0);
    this.lastLap = this.cars.map(() => 0);
    this.lastFinished = this.cars.map(() => false);
  }

  private endRace(): void {
    if (!this.racing) return;
    this.racing = false;
    // Only when the CLOCK ended it. If everyone finished, the last car crossing
    // the line already played this from `updateLapLabels`, and a second one on
    // the same frame would just be the first one thickened.
    if (!this.manager.allFinished()) sfx('rc-finish');
    this.stopLoops();
    // Hands every car back unmodified and takes the pickups and slicks off the
    // track, so nothing is left tinted or capped on the results screen.
    this.powerups.clear();
    this.series.recordRace(this.manager.results());
    this.scene.start('Results');
  }

  /**
   * Fade the held voices out rather than cutting them. The handle ramps the gain
   * before stopping the source for exactly this reason — a loop cut at an
   * arbitrary sample is a click.
   */
  private stopLoops(): void {
    for (const engine of this.engines) engine.stop(180);
    this.engines = [];
    this.skid?.stop(180);
    this.skid = null;
  }

  /** Two-column grid behind the start line, players in random order. */
  private spawnCars(): void {
    const order = this.players.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.players.forEach((controller, playerIndex) => {
      const slot = order.indexOf(playerIndex);
      const spawn = this.analysis.spawns[slot] ?? this.analysis.spawns[0];
      const car = new Car(this, playerIndex, spawn.x, spawn.y, spawn.headingRad, carKey(playerIndex));
      this.cars.push(car);
      this.inputs.push(new CarInput(controller));

      const label = this.add
        .text(spawn.x, spawn.y, '', {
          fontFamily: FONT,
          fontSize: uiFont(TYPE.label),
          color: `#${playerColor(playerIndex).toString(16).padStart(6, '0')}`,
          fontStyle: 'bold',
          stroke: '#0b1017',
          strokeThickness: ui(5),
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.hud);
      this.lapLabels.push(label);
    });
  }

  /**
   * Everything the race sounds like, once a frame: the engines, the tyres, the
   * crashes and the laps.
   *
   * Rate and volume go through the handle's `setRate`/`setVolume`, which ramp
   * rather than jump — stepping a playback rate per frame is a zipper noise, and
   * these values change every frame by design.
   */
  private updateAudio(dt: number, controls: CarControl[]): void {
    let corner = 0;

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const fraction = Math.min(Math.abs(car.speed) / CAR.MAX_SPEED, 1);

      const engine = this.engines[i];
      if (engine) {
        engine.setRate(IDLE_RATE + (REDLINE_RATE - IDLE_RATE) * fraction);
        // A finished car is parked and its engine is off; the others idle
        // audibly even when stopped, because a car sitting against a wall with
        // the throttle open should not fall silent.
        const idle = car.isFinished ? 0 : 0.45;
        engine.setVolume(ENGINE_VOLUME * (idle + (1 - idle) * fraction));
      }

      // A wall taken hard enough to cost real speed. `minGap` is left at its
      // default, so four cars piling into the same corner is one crash to the ear.
      if (car.takeCrashLoss() > CRASH_THRESHOLD) sfx('rc-crash');

      // Tyres scrub when a car is turning AND moving; either alone is silent.
      if (!car.isFinished) {
        corner = Math.max(corner, Math.abs(controls[i]?.steer ?? 0) * fraction);
      }
    }

    const target = Math.min(corner / SKID_FULL, 1);
    // Asymmetric smoothing: tyres bite quickly and let go slowly, and a
    // frame-rate-independent approach keeps that feel on any device.
    const rate = target > this.skidLevel ? SKID_RISE : SKID_FALL;
    this.skidLevel += (target - this.skidLevel) * Math.min(1, rate * dt);
    this.skid?.setVolume(this.skidLevel * 0.5);
  }

  /**
   * Everything the race kicks up, once a frame.
   *
   * The particle module owns no update hook of its own — placing an emitter and
   * smoothing a value are both this scene's job, because both need state this
   * scene already has. The offset is taken off `headingRad` rather than the
   * sprite's rotation on purpose: the sprite carries `SPRITE_FORWARD_OFFSET`
   * baked in, because Kenney's cars are drawn pointing up.
   */
  private updateDust(dt: number, controls: CarControl[]): void {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const speed = Math.abs(car.speed);
      const fraction = Math.min(speed / CAR.MAX_SPEED, 1);
      const steer = controls[i]?.steer ?? 0;
      const heading = car.headingRad;

      // Two separate speed gates, because the plumes mean different things. A
      // parked car raises nothing, and a finished one is parked.
      const parked = car.isFinished;
      const rolling = parked
        ? 0
        : Phaser.Math.Clamp((speed - DUST_FADE_FROM) / (DUST_FADE_TO - DUST_FADE_FROM), 0, 1);
      const fast = parked
        ? 0
        : Phaser.Math.Clamp((speed - SLIDE_FADE_FROM) / (SLIDE_FADE_TO - SLIDE_FADE_FROM), 0, 1);

      const back = -CAR.DISPLAY_LENGTH * DUST_BACK_FRAC;

      // ── Trail: speed alone, off the back ──────────────────────────────
      const trail = this.dust[i];
      if (trail) {
        this.dustLevel[i] = approach(
          this.dustLevel[i] ?? 0,
          rolling * Math.min(1, fraction * DUST_CRUISE),
          dt,
        );
        trail
          .setPosition(car.x + Math.cos(heading) * back, car.y + Math.sin(heading) * back)
          .setIntensity(this.dustLevel[i]);
        // Thrown the way the car came from, so it trails instead of spraying
        // evenly. Particles carry none of the car's own velocity, so this angle
        // is the whole of what makes a plume read as "left behind". Through
        // `emitter` rather than the handle on purpose: aiming an emitter is
        // something Phaser already does well, and the module wraps only what it
        // does not.
        trail.emitter?.setEmitterAngle(
          Phaser.Math.RadToDeg(heading + Math.PI) +
            Phaser.Math.FloatBetween(-DUST_SPREAD_DEG, DUST_SPREAD_DEG),
        );
      }

      // ── Slide: steering lock, off the outer flank ─────────────────────
      const slide = this.slide[i];
      if (slide) {
        this.slideLevel[i] = approach(
          this.slideLevel[i] ?? 0,
          fast * Math.min(1, Math.abs(steer) / SLIDE_LOCK_FULL),
          dt,
        );

        // Exactly where the trail comes from. The two plumes are one place and
        // two behaviours: this one is bigger, sparser, longer-lived and stays put.
        slide
          .setPosition(car.x + Math.cos(heading) * back, car.y + Math.sin(heading) * back)
          .setIntensity(this.slideLevel[i]);

        // No aim: `rc-slide` emits at zero speed, so these hang where they were
        // dropped and the car drives out from under them. Nothing to point.
      }
    }
  }

  private updateLapLabels(): void {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const label = this.lapLabels[i];
      label.setPosition(car.x, car.y - 52);
      const finished = this.manager.isFinished(i);
      // What is running on this car, on a second line under the lap count. Plain
      // words from the same font rather than a symbol: FONT is the game's own
      // face and there is no guarantee it carries a snowflake.
      //
      // `setText` is a no-op when the string has not changed (Phaser checks), so
      // building it every frame costs nothing in the usual case where it hasn't.
      const effect = this.powerups
        .activeKeys(i)
        .map((key) => powerupDef(key)?.label ?? '')
        .filter(Boolean)
        .join(' ');
      const lapText = finished ? '✓' : `${this.manager.displayLap(i)}/${this.series.laps}`;
      label.setText(effect ? `${lapText}\n${effect}` : lapText);

      // The label is where a lap becomes visible, so it is also where it becomes
      // audible. Finishing replaces the lap sound rather than doubling it: the
      // last lap and the chequered flag are the same crossing.
      const lap = this.manager.displayLap(i);
      if (finished && !this.lastFinished[i]) {
        this.lastFinished[i] = true;
        sfx('rc-finish');
        this.celebrate(car.x, car.y);
      } else if (!finished && lap > (this.lastLap[i] ?? 0)) {
        sfx('rc-lap');
      }
      this.lastLap[i] = lap;
    }
  }

  /**
   * Fireworks over a car that has just crossed the line for the last time.
   *
   * Coordinates are captured rather than the car being held onto: the second
   * burst is a couple of hundred ms later, and it belongs where the driver
   * finished, not wherever their parked sprite has been nudged to since.
   *
   * `delayedCall` goes through the scene Clock, which `PauseMenu` stops with the
   * rest of the scene — so pausing between the two bursts holds the second one
   * rather than firing it into a paused screen.
   */
  private celebrate(x: number, y: number): void {
    const uiCam = this.cameras.getCamera('ui');
    const pop = (dx: number, dy: number): void => {
      const handle = vfx(this, 'rc-firework', { x: x + dx, y: y + dy, depth: DEPTH.objHigh });
      // Created long after setupCameras built the ignore list, so it has to opt
      // out by hand or it is drawn again at unscrolled screen coordinates.
      if (handle.emitter) uiCam?.ignore(handle.emitter);
    };
    pop(0, -34);
    this.time.delayedCall(240, () =>
      pop(Phaser.Math.Between(-80, 80), Phaser.Math.Between(-96, -24)),
    );
  }

  private setupCameras(): void {
    const { worldWidth: w, worldHeight: h } = this.track;
    const main = this.cameras.main;
    const fit = Math.min(this.scale.height / h, this.scale.width / Math.max(1, w - 4 * TILE));
    main.setZoom(fit * CAMERA.ZOOM_SCALE);
    main.centerOn(w / 2, h / 2);
    main.setRoundPixels(true); // snap tile positions to integers → fewer seams

    const debugGfx = this.matter.world.debugGraphic;
    debugGfx?.setDepth(DEPTH.debug);

    const ui = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    ui.setName('ui');
    ui.ignore([
      ...this.track.containers,
      ...this.cars.map((c) => c.sprite),
      ...this.lapLabels,
      ...(this.debug ? [this.debug] : []),
      ...(this.lineMarker ? [this.lineMarker] : []),
      ...(debugGfx ? [debugGfx] : []),
    ]);
    main.ignore([this.infoText, this.clockText, this.timerBar, this.dbgText, this.toastText]);
  }

  private buildHud(trackId: number): void {
    const { width } = this.scale;
    const outline = { stroke: '#0b1017', strokeThickness: ui(8) };
    const raceNo = this.series.raceIndex + 1;

    // Depleting timer strip along the very top edge (like pin-the-tail).
    this.timerBarMaxW = width;
    this.timerBar = this.add.rectangle(0, 0, width, 12, 0x51d88a).setOrigin(0, 0).setDepth(DEPTH.hud);

    // Context on the left, two lines.
    this.infoText = this.add
      .text(40, 34, t('hud.race', {
        race: raceNo,
        total: this.series.totalRaces,
        track: trackId + 1,
        laps: this.series.laps,
      }), {
        fontFamily: FONT,
        fontSize: uiFont(TYPE.subheading),
        color: '#e8ecf3',
        lineSpacing: 6,
        ...outline,
      })
      .setOrigin(0, 0)
      .setDepth(DEPTH.hud);

    // Timer centered (starts at laps × one minute).
    this.clockText = this.add
      .text(width / 2, 78, this.formatClock(this.series.laps * RACE.LAP_MS), {
        fontFamily: FONT,
        fontSize: uiFont(72),
        color: '#ffd166',
        fontStyle: 'bold',
        ...outline,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud);

    // Powerup announcement, dead centre of the screen. Built once and left
    // invisible; every announcement retargets it (see `announce`).
    //
    // On the UI camera, so this is screen centre and not world centre — the two
    // are different here, because the world camera is zoomed to fit the track.
    this.toastText = this.add
      .text(width / 2, this.scale.height / 2, '', {
        fontFamily: FONT,
        fontSize: uiFont(TYPE.heading),
        color: '#ffffff',
        fontStyle: 'bold',
        ...outline,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud)
      .setAlpha(0);

    // Live input/lap values (bottom-left) for tuning steering, throttle, the
    // assist and the rewind. Hidden — flip SHOW_DEBUG_TEXT to bring it back.
    this.dbgText = this.add
      .text(24, this.scale.height - 24, '', {
        fontFamily: 'monospace',
        fontSize: uiFont(TYPE.label),
        color: '#9fef00',
        stroke: '#0b1017',
        strokeThickness: ui(6),
      })
      .setOrigin(0, 1)
      .setDepth(DEPTH.hud)
      .setVisible(SHOW_DEBUG_TEXT);
  }

  private updateDebug(): void {
    if (!SHOW_DEBUG_TEXT) return;
    const info = this.inputs[0]?.debugInfo();
    if (!info) return;
    const line = this.racingLine;
    const lapLines = this.cars.map((car, i) => {
      const d = this.manager.debugState(i);
      let onLine = '';
      if (line) {
        const idx = this.lineIndex[i] ?? 0;
        const off = line.lateralOffset(car.x, car.y, idx);
        const nudge = ((this.assistNudge[i] ?? 0) * 1000).toFixed(0).padStart(4);
        const pct = (v: number | undefined) => ((v ?? 0) * 100).toFixed(0).padStart(4);
        // p = progress %, b = best (what a rewind measures back from),
        // o = px off the line, a = assist nudge in milliradians/frame.
        onLine =
          ` p${pct(this.progress[i])} b${pct(this.bestProgress[i])}` +
          ` o${off.toFixed(0).padStart(4)} a${nudge}`;
      }
      return `P${i} lap ${d.lap} f${d.netFwd.toFixed(2).padStart(6)}${onLine}`;
    });
    this.dbgText.setText(
      [
        `wheel ${info.angle.toFixed(0).padStart(4)}°`,
        `steer ${info.steer.toFixed(3).padStart(6)}`,
        `pitch ${info.throttleRaw.toFixed(1).padStart(5)}°`,
        `thr   ${info.throttle.toFixed(3).padStart(6)}`,
        ...lapLines,
      ].join('\n'),
    );
  }

  /** Toggle with 'D': loop cells, checkpoints, finish line, spawns, racing line. */
  private buildDebug(): void {
    const g = this.add.graphics().setDepth(DEPTH.debug).setVisible(false);
    this.drawRacingLine(g);
    g.fillStyle(0x4da6ff, 0.35);
    for (const c of this.analysis.loop) {
      g.fillCircle(c.col * TILE + TILE / 2, c.row * TILE + TILE / 2, 8);
    }
    g.fillStyle(0xffd166, 0.9);
    for (const c of this.analysis.checkpoints) {
      g.fillCircle(c.col * TILE + TILE / 2, c.row * TILE + TILE / 2, 16);
    }
    g.lineStyle(ui(6), 0xffffff, 0.9);
    g.lineBetween(
      this.analysis.finishLine.a.x,
      this.analysis.finishLine.a.y,
      this.analysis.finishLine.b.x,
      this.analysis.finishLine.b.y,
    );
    g.fillStyle(0x51d88a, 0.9);
    for (const s of this.analysis.spawns) g.fillCircle(s.x, s.y, 12);
    this.debug = g;
    // Per-frame layer: each car's projection onto the racing line.
    this.lineMarker = this.add.graphics().setDepth(DEPTH.debug).setVisible(false);
  }

  /** The baked racing line: closed path + direction arrows + lap origin. */
  private drawRacingLine(g: Phaser.GameObjects.Graphics): void {
    const line = this.racingLine;
    if (!line) return;
    const pts = Array.from({ length: line.count }, (_, i) => {
      const p = line.pointAt(i);
      return new Phaser.Math.Vector2(p.x, p.y);
    });

    g.lineStyle(ui(5), 0xff9f43, 0.85);
    g.strokePoints(pts, true);

    // Arrowheads along the way so the driving direction is unmistakable.
    g.lineStyle(ui(4), 0xffffff, 0.9);
    const step = Math.max(8, Math.round(line.count / 12));
    for (let i = 0; i < line.count; i += step) {
      const s = line.sample(i);
      for (const spread of [2.6, -2.6]) {
        g.lineBetween(
          s.x,
          s.y,
          s.x - 22 * Math.cos(s.headingRad + spread * 0.4),
          s.y - 22 * Math.sin(s.headingRad + spread * 0.4),
        );
      }
    }

    // Lap origin (progress 0) — sits on the finish line.
    const start = line.sample(0);
    g.fillStyle(0x51d88a, 1);
    g.fillCircle(start.x, start.y, 11);
  }

  /**
   * Project every car onto the racing line each frame. The previous index is
   * fed back as a search hint, so this is a short local scan, not a full sweep —
   * and it is the same lookup the steering assist and the rewind will use.
   */
  private updateLineTracking(): void {
    const line = this.racingLine;
    if (!line) return;
    for (let i = 0; i < this.cars.length; i++) {
      // Mid-swap the car is being carried across the track by a tween, not
      // driven. Accumulating that as progress would credit (or debit) each
      // driver the whole gap between them, on top of the exchange itself.
      if (this.cars[i].isSuspended) continue;
      const prev = this.lineIndex[i];
      const idx = line.nearestIndex(this.cars[i].x, this.cars[i].y, prev);
      this.lineIndex[i] = idx;
      if (prev === undefined) {
        // Grid slots sit behind the finish line, so this starts negative.
        this.progress[i] = line.wrapDelta(idx) / line.count;
      } else {
        this.progress[i] += line.wrapDelta(idx - prev) / line.count;
      }
      this.bestProgress[i] = Math.max(this.bestProgress[i] ?? -Infinity, this.progress[i]);
    }
  }

  /** Steering assist: how hard each car gets nudged back toward the line. */
  private updateAssist(dt: number, controls: CarControl[]): void {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const result = this.assist.compute(
        {
          x: car.x,
          y: car.y,
          headingRad: car.headingRad,
          speed: car.speed,
          steer: controls[i].steer,
          lineIndex: this.lineIndex[i] ?? 0,
        },
        dt,
        // Undefined unless this car is boosted, in which case the profile both
        // strengthens the pull and pushes the speed fade out past the boosted
        // cruise it would otherwise cancel the assist at.
        this.powerups.assistProfile(i),
      );
      this.assistNudge[i] = result.nudgeRad;
      this.assistDebug[i] = result.target;
    }
  }

  /**
   * Rewind: reappear a little way back down the racing line, pointing the right
   * way and stopped. Available in every difficulty — it recovers a car that is
   * stuck or facing a wall rather than making it faster.
   */
  private rewindCar(i: number): void {
    const line = this.racingLine;
    const car = this.cars[i];
    if (!line || car.isFinished) return;
    const now = this.time.now;
    if (now - (this.rewindAt[i] ?? -Infinity) < REWIND.COOLDOWN_MS) return;
    this.rewindAt[i] = now;

    // Measure back from the car's BEST progress, not its current position, so
    // pressing again after crawling forward a little returns to the same spot
    // instead of walking backwards down the track press by press. Floored at the
    // start line, and never ahead of where the car actually is — so a press on
    // the grid can't shunt it forward onto the line.
    const here = this.progress[i] ?? 0;
    const target = Math.min(here, Math.max(0, (this.bestProgress[i] ?? here) - REWIND.FRACTION));

    const spot = line.sample(Math.round(target * line.count));
    car.resetTo(spot.x, spot.y, spot.headingRad);
    this.lineIndex[i] = spot.index;
    this.progress[i] = target; // best is untouched: this ground must be re-driven
    this.assistNudge[i] = 0;
    this.manager.notifyTeleport(i, spot.x, spot.y);

    // Read as a deliberate reappearance rather than a glitch — heard as one too.
    sfx('rc-rewind');
    car.sprite.setAlpha(0.25);
    this.tweens.add({ targets: car.sprite, alpha: 1, duration: REWIND.FLASH_MS });
  }

  // ------------------------------------------------------------ PowerupHost

  lineIndexOf(carIndex: number): number {
    return this.lineIndex[carIndex] ?? 0;
  }

  /**
   * Two cars trade places on the track — the replace powerup.
   *
   * **Position and heading only: each driver keeps their own lap.** The lap
   * bookkeeping stays put in `RaceManager` (see `notifySwap`); what moves here is
   * only the scene's idea of *where* each car is.
   *
   * `progress` has to be re-anchored rather than either swapped or left alone.
   * Left alone, `updateLineTracking` would accumulate the whole width of the jump
   * next frame as if it had been driven; and it feeds the rewind, which is
   * floored at "never ahead of where the car actually is" — a stale value there
   * would let a driver swapped backwards press rewind and be teleported straight
   * back to where they came from, undoing the powerup for free.
   *
   * So the fractional part follows the car to its new spot and the lap number
   * comes along unchanged: `Math.round` picks the whole-lap offset that keeps the
   * new value nearest the old, which is exactly "same lap, different point in it".
   */
  swapPlaces(a: number, b: number): boolean {
    const line = this.racingLine;
    if (a === b || !line) return false;
    const carA = this.cars[a];
    const carB = this.cars[b];
    if (!carA || !carB || carA.isFinished || carB.isFinished) return false;

    const reanchor = (i: number, car: Car): void => {
      const idx = line.nearestIndex(car.x, car.y);
      this.lineIndex[i] = idx;
      const fraction = idx / line.count;
      const was = this.progress[i] ?? 0;
      const now = fraction + Math.round(was - fraction);
      this.progress[i] = now;
      // Pulled DOWN to the new position as well as up: `bestProgress` is what a
      // rewind measures back from, and leaving a swapped-back driver's old best
      // in place would turn the rewind button into a free undo of the swap.
      this.bestProgress[i] = now;
      this.assistNudge[i] = 0;
      this.manager.notifySwap(i, car.x, car.y);
    };

    reanchor(a, carA);
    reanchor(b, carB);
    return true;
  }

  /** Anything created after `setupCameras` must opt out of the UI camera. */
  adopt(obj: Phaser.GameObjects.GameObject): void {
    this.cameras.getCamera('ui')?.ignore(obj);
  }

  /**
   * Name the player and the powerup, briefly, over the HUD.
   *
   * One reused Text rather than one per announcement: four cars can collect
   * within a second of each other, and a stack of overlapping toasts says less
   * than the last one alone. A second announcement simply retargets this.
   */
  announce(carIndex: number, label: string): void {
    if (!label) return;
    const playerIndex = this.cars[carIndex]?.playerIndex ?? carIndex;
    this.tweens.killTweensOf(this.toastText);
    this.toastText
      .setText(`P${playerIndex + 1} · ${label}`)
      .setColor(`#${playerColor(playerIndex).toString(16).padStart(6, '0')}`)
      .setAlpha(1)
      .setScale(0.7);
    this.tweens.add({
      targets: this.toastText,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: this.toastText,
      alpha: 0,
      delay: 900,
      duration: 320,
    });
  }

  /** Live per-car projection onto the line (position + heading it wants). */
  private drawLineMarkers(): void {
    const g = this.lineMarker;
    const line = this.racingLine;
    if (!g || !line || !g.visible) return;
    g.clear();
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const s = line.sample(this.lineIndex[i] ?? 0);
      g.lineStyle(ui(3), 0x9fef00, 0.8);
      g.lineBetween(car.x, car.y, s.x, s.y);
      g.fillStyle(0x9fef00, 1);
      g.fillCircle(s.x, s.y, 6);

      // Where the steering assist is aiming (empty when it is not helping).
      const aim = this.assistDebug[i];
      if (aim) {
        g.lineStyle(ui(3), 0xff4d9d, 0.8);
        g.lineBetween(car.x, car.y, aim.x, aim.y);
        g.fillStyle(0xff4d9d, 1);
        g.fillCircle(aim.x, aim.y, 7);
      }
    }
  }

  private formatClock(ms: number): string {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }
}
