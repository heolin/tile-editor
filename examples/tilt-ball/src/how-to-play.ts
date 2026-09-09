import type { InfoSection } from '@kapsel/shared';
import { t } from './i18n/strings';

/**
 * The steps behind the "?" in the corner of the setup screen.
 *
 * A function rather than a constant, like every table of copy in this repo: the
 * strings come from `t()`, and one built at import time would hold whichever
 * language was current when this module first loaded.
 *
 * The rows carry no icon on purpose — `InfoOverlay` then numbers them, which is
 * what makes a page of steps read as an order rather than as four facts.
 */
export function howToPlay(): InfoSection[] {
  return [
    { title: t('howto.1.title'), body: t('howto.1.body') },
    { title: t('howto.2.title'), body: t('howto.2.body') },
    { title: t('howto.3.title'), body: t('howto.3.body') },
  ];
}
