'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sisterLink, pathCandidates } = require('../src/core/links');

test('links to another project are recognised, with the page and the place in it', () => {
  assert.deepEqual(sisterLink('https://en.wikibooks.org/wiki/First_Aid#Burns'), { project: 'wikibooks', path: 'First_Aid', hash: '#Burns' });
  assert.deepEqual(sisterLink('http://en.m.wikipedia.org/wiki/Saturn%20V'), { project: 'wikipedia', path: 'Saturn_V', hash: '' });
  assert.deepEqual(sisterLink('https://en.wikiversity.org/wiki/Physics/Essays/Fedosin'), { project: 'wikiversity', path: 'Physics/Essays/Fedosin', hash: '' });
  assert.deepEqual(sisterLink('https://en.wikibooks.org/wiki/Cookbook:Bread'), { project: 'wikibooks', path: 'Cookbook:Bread', hash: '' });
  assert.deepEqual(sisterLink('https://en.wikipedia.org/w/index.php?title=Moon'), { project: 'wikipedia', path: 'Moon', hash: '' });
});

test('anything else stays a web link', () => {
  for (const url of [
    'https://example.org/wiki/Moon',
    'https://fr.wikipedia.org/wiki/Lune',                         // another language
    'https://en.wiktionary.org/wiki/moon',                        // a project that is not offered
    'https://en.wikipedia.org/w/index.php?title=Moon&action=edit',
    'https://en.wikipedia.org/wiki/Special:Search/moon',
    'https://en.wikipedia.org/wiki/File:Moon.jpg',
    'https://en.wikipedia.org/',
    'https://commons.wikimedia.org/wiki/Moon',
    'mailto:someone@en.wikipedia.org',
    'not a url at all',
  ]) assert.equal(sisterLink(url), null, url);
  assert.deepEqual(sisterLink('https://fr.wikipedia.org/wiki/Lune', 'fr'), { project: 'wikipedia', path: 'Lune', hash: '' });
});

test('a title is also tried with its first letter capitalised', () => {
  assert.deepEqual(pathCandidates('first_Aid'), ['first_Aid', 'First_Aid']);
  assert.deepEqual(pathCandidates('Moon'), ['Moon']);
});
