'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { features } = require('../src/core/features');

test('a part of the app is on or off by the build, then the computer, then the tests', () => {
  assert.deepEqual(features(), { school: false }, 'off unless something says otherwise');
  assert.deepEqual(features({ pkg: { wikivault: { features: { school: true } } } }), { school: true });
  assert.deepEqual(features({ pkg: { wikivault: { features: { school: false } } }, settings: { features: { school: true } } }), { school: true }, 'one computer can switch it on');
  assert.deepEqual(features({ pkg: { wikivault: { features: { school: true } } }, env: { WIKIVAULT_FEATURES: '-school' } }), { school: false });
  assert.deepEqual(features({ env: { WIKIVAULT_FEATURES: ' school , nothing ' } }), { school: true }, 'names it does not know are ignored');
  assert.deepEqual(features({ settings: { features: { school: 'yes', other: true } } }), { school: false }, 'only true and false count, and only for parts that exist');
});

test('the build that is released leaves School out', () => {
  assert.equal(features({ pkg: require('../package.json') }).school, false);
});
