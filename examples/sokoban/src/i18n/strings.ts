// From `@kapsel/shared/i18n`, not the package barrel: the level loader and the
// rules here are pure modules imported by node tests, and the barrel pulls
// Phaser in with it. See docs/i18n.md.
import { makeStrings } from '@kapsel/shared/i18n';
import de from './de.json';
import en from './en.json';
import es from './es.json';
import ja from './ja.json';
import pl from './pl.json';
import ptBR from './pt-BR.json';

/**
 * This game's own copy.
 *
 * Level TITLES are not here: they live in the `.tmj` files, written in Tiled
 * next to the level they name. See docs/i18n.md for what that costs.
 */
export const t = makeStrings(en, { es, 'pt-BR': ptBR, de, ja, pl });
