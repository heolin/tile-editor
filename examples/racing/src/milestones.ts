import { dailyOrbClaimed, orbMilestoneClaimed, type MilestoneList } from '@kapsel/shared';
import { TRACK_COUNT } from './race-series';
import { t } from './i18n/strings';

/**
 * What the trophy in the corner of the menu shows.
 *
 * Racing pays an orb the first time each TRACK is finished, keyed by the track's
 * own id — see `leaderboard-scene`, which claims against `currentTrack()` once
 * the random pick has resolved to a concrete track. One row each: with five of
 * them the list is a checklist a player can actually work through, which is the
 * point of naming them rather than folding them into a tally the way Tilt Ball's
 * thirty-one boards have to be.
 *
 * Numbered from 1 in the copy and from 0 in the key, because that is how the
 * race HUD already names them (`trackId + 1`). The id is what the orb ledger is
 * keyed by and must not shift; the number is only what the player reads.
 */
export function milestones(): MilestoneList {
  return {
    daily: { label: t('milestones.daily'), done: dailyOrbClaimed('racing') },
    milestones: Array.from({ length: TRACK_COUNT }, (_, id) => ({
      label: t('milestones.track', { number: id + 1 }),
      done: orbMilestoneClaimed('racing', id),
    })),
  };
}
