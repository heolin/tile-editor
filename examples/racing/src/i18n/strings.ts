// From `@kapsel/shared/i18n`, not the package barrel: a game's pure modules
// hold copy too, and the barrel pulls Phaser in with it. See docs/i18n.md.
import { makeStrings } from '@kapsel/shared/i18n';
import de from './de.json';
import en from './en.json';
import es from './es.json';
import ja from './ja.json';
import pl from './pl.json';
import ptBR from './pt-BR.json';

/** This game's own copy. See docs/i18n.md. */
export const t = makeStrings(en, { es, 'pt-BR': ptBR, de, ja, pl });
