import { registerPowerups, type PowerupDef } from '@kapsel/shared';
import { t } from '../i18n/strings';
import { powerupIconKey } from '../track/track-assets';

/**
 * The four racing powerups, keyed `rc-*` so nothing can collide with another
 * game's pack in the page-level registry — the same rule this game's textures,
 * sounds and effects follow.
 *
 * Registered on import, like `RACING_SOUNDS` and `RACING_FX`: it fills a map and
 * does nothing else, so importing this module anywhere in the game is the whole
 * wiring.
 *
 * What each one DOES lives in `manager.ts`, not here. The shared runtime spawns
 * these, times them and announces them; applying them is the game's, because no
 * cross-game vocabulary of effects survives contact with a second game.
 */
export const RC_FREEZE = 'rc-freeze';
export const RC_OIL = 'rc-oil';
export const RC_REPLACE = 'rc-replace';
export const RC_BOOST = 'rc-boost';

/** Every kind, in the order they should be explained to a player. */
export const POWERUP_KINDS = [RC_BOOST, RC_FREEZE, RC_OIL, RC_REPLACE] as const;

/**
 * Kinds that do nothing without a rival still driving, and so must not be drawn
 * in a one-player race or once everyone else has finished — a pickup that fires
 * and changes nothing reads as a bug, not as bad luck.
 */
export const NEEDS_RIVAL = new Set<string>([RC_FREEZE, RC_REPLACE]);

export const RACING_POWERUPS: Readonly<Record<string, PowerupDef>> = {
  [RC_BOOST]: {
    icon: powerupIconKey('speed'),
    // Getters, like every other table built at import time in this repo.
    get label() { return t('powerup.speed'); },
    sound: RC_BOOST,
  },
  [RC_FREEZE]: {
    icon: powerupIconKey('freeze'),
    get label() { return t('powerup.freeze'); },
    sound: RC_FREEZE,
  },
  [RC_OIL]: {
    icon: powerupIconKey('oil'),
    get label() { return t('powerup.oil'); },
    sound: RC_OIL,
  },
  [RC_REPLACE]: {
    icon: powerupIconKey('replace'),
    get label() { return t('powerup.swap'); },
    sound: RC_REPLACE,
  },
};

registerPowerups(RACING_POWERUPS);
