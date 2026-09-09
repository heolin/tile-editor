import { claimedMilestoneCount, dailyOrbClaimed, type MilestoneList } from '@kapsel/shared';
import { levelsFor } from './level/levels';
import { t } from './i18n/strings';

/**
 * What the trophy in the corner of the setup screen shows.
 *
 * Not the score ladder six of the games have: this one pays an orb the first
 * time each BOARD is cleared, keyed by the level id (see `results-scene`). There
 * are thirty-odd of them and there will be more, so the screen folds each mode
 * into one counted row — `7 / 31` — rather than listing boards nobody would
 * scroll through. It is still one orb per board; the tally is what says how many
 * are already in.
 *
 * The ids come from `levelsFor`, which is the same list the results screen
 * claims against, so a board added to the folder turns up here with no change.
 */
export function milestones(): MilestoneList {
  const story = levelsFor('story').map((level) => level.id);
  const versus = levelsFor('versus').map((level) => level.id);
  return {
    daily: { label: t('milestones.daily'), done: dailyOrbClaimed('tilt-ball') },
    milestones: [
      {
        label: t('milestones.story'),
        count: { done: claimedMilestoneCount('tilt-ball', story), total: story.length },
      },
      {
        label: t('milestones.versus'),
        count: { done: claimedMilestoneCount('tilt-ball', versus), total: versus.length },
      },
    ],
  };
}
