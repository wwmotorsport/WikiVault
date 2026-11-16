'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tourPlan } = require('../src/core/tour');

test('the tour opens at every start until it is switched off', () => {
  assert.deepEqual(tourPlan(undefined, '0.15.0'), { show: true, whatsNew: false }, 'first ever start');
  assert.deepEqual(tourPlan({ hide: false, seenVersion: '0.15.0' }, '0.15.0'), { show: true, whatsNew: false }, 'seen, not switched off');
  assert.deepEqual(tourPlan({ hide: true, seenVersion: '0.15.0' }, '0.15.0'), { show: false, whatsNew: false }, 'switched off');
});

test('a new version shows it once more, with what is new, even when it was switched off', () => {
  assert.deepEqual(tourPlan({ hide: true, seenVersion: '0.15.0' }, '0.16.0'), { show: true, whatsNew: true });
  assert.deepEqual(tourPlan({ hide: false, seenVersion: '0.14.0' }, '0.15.0'), { show: true, whatsNew: true });
  // Switched off before the version was ever recorded: treated as not yet seen.
  assert.deepEqual(tourPlan({ hide: true, seenVersion: null }, '0.15.0'), { show: true, whatsNew: false });
});
