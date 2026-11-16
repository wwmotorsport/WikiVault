'use strict';
// When the guided tour (the numbered bubbles over the main window) opens by itself.

/**
 * @param {{hide?: boolean, seenVersion?: string|null}} tour  what settings remember
 * @param {string} version                                    the version that is running
 * Shown at every start until "Don't show again" is chosen, and once more the first time each new
 * version runs, whatever was chosen before. `whatsNew` is true only for that upgrade case.
 */
function tourPlan(tour, version) {
  const hide = Boolean(tour?.hide);
  const seen = tour?.seenVersion || null;
  const upgraded = Boolean(seen) && seen !== version;
  return { show: !hide || seen !== version, whatsNew: upgraded };
}

module.exports = { tourPlan };
