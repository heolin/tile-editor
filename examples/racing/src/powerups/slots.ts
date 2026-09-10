import type { PowerupSlot } from '@kapsel/shared';
import { POWERUP } from '../constants';
import type { RacingLine } from '../race/racing-line';

/**
 * Where powerups may appear on a track.
 *
 * Derived from the baked racing line rather than hand-placed per track, which
 * means they are **fixed per track** — the line is — without a sixth data file
 * per circuit to author and keep in sync, and any track added later gets them for
 * free. Positions are learnable; which slot fills and with what is not.
 *
 * Slots alternate either side of the line so they are worth steering for rather
 * than collected by simply driving.
 *
 * No on-road test, and none is needed: the line is the road centreline, so a
 * point on it is on the road by construction, and the clearance either side
 * measures 60px at the tightest point of all five tracks — more than twice
 * `POWERUP.SLOT_LATERAL`. Keep that ratio and the offset cannot leave the
 * tarmac. (A test was tried, against `TrackAnalysis.loop`, and only ever gave
 * false negatives — see the note on `OilSlicks.place`.)
 *
 * If hand-placed slots are ever wanted, the seam is a `trackN.powerups.json`
 * baked next to `trackN.path.json` and read here instead.
 */
export function buildPowerupSlots(line: RacingLine | null): PowerupSlot[] {
  if (!line) return [];
  const slots: PowerupSlot[] = [];

  for (let i = 0; i < POWERUP.SLOTS; i++) {
    // Half-step offset so no slot sits exactly on the finish line, where cars are
    // packed together on the grid and one of them would take it off the gun.
    const s = line.at((i + 0.5) / POWERUP.SLOTS);
    const side = i % 2 === 0 ? 1 : -1;
    // The line's own normal: heading rotated a quarter turn, pointing right of
    // travel — the same one `RacingLine.lateralOffset` measures against.
    slots.push({
      x: s.x - Math.sin(s.headingRad) * side * POWERUP.SLOT_LATERAL,
      y: s.y + Math.cos(s.headingRad) * side * POWERUP.SLOT_LATERAL,
    });
  }

  return slots;
}
