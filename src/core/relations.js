'use strict';
// How saved people and places are sorted: pins (Home, Work...), relationship groups (Family, Friends...)
// and the tie itself (mother, wife, father-in-law...). Also the everyday words that mean the same tie,
// so "mom", "my mum" and "mother" all find the same person. No Electron, no network.

const PINS = [
  { id: 'home', name: 'Home' },
  { id: 'work', name: 'Work' },
  { id: 'school', name: 'School' },
  { id: 'meet', name: 'Meeting point' },
  { id: 'other', name: 'Other' },
];
const GROUPS = [
  { id: 'family', name: 'Family' },
  { id: 'friends', name: 'Friends' },
  { id: 'work', name: 'Work' },
  { id: 'neighbors', name: 'Neighbors' },
  { id: 'care', name: 'Doctors and care' },
  { id: 'other', name: 'Other' },
];
/** The ties offered in the form, by group. Any other wording may be typed. */
const TIES = {
  family: ['wife', 'husband', 'partner', 'mother', 'father', 'son', 'daughter', 'brother', 'sister', 'grandmother', 'grandfather', 'grandson', 'granddaughter', 'aunt', 'uncle', 'cousin', 'niece', 'nephew',
    'mother-in-law', 'father-in-law', 'brother-in-law', 'sister-in-law', 'son-in-law', 'daughter-in-law', 'stepmother', 'stepfather', 'stepson', 'stepdaughter', 'stepbrother', 'stepsister', 'godmother', 'godfather', 'fiancee', 'fiance', 'girlfriend', 'boyfriend'],
  friends: ['friend', 'best friend'],
  work: ['boss', 'colleague', 'employee', 'client', 'supplier'],
  neighbors: ['neighbor'],
  care: ['doctor', 'dentist', 'vet', 'pharmacist', 'nurse', 'babysitter', 'teacher', 'pastor'],
  other: [],
};

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Everyday words for a tie. A word may stand for several ties ("parents", "spouse").
const SAME = {
  mom: ['mother'], mum: ['mother'], mommy: ['mother'], mummy: ['mother'], mama: ['mother'], momma: ['mother'], ma: ['mother'],
  dad: ['father'], daddy: ['father'], papa: ['father'], pa: ['father'], pop: ['father'], pops: ['father'],
  parent: ['mother', 'father'], parents: ['mother', 'father'], folks: ['mother', 'father'],
  grandma: ['grandmother'], granny: ['grandmother'], nana: ['grandmother'], gran: ['grandmother'], grandmom: ['grandmother'], grandmum: ['grandmother'],
  grandpa: ['grandfather'], granddad: ['grandfather'], grandad: ['grandfather'], gramps: ['grandfather'],
  grandparent: ['grandmother', 'grandfather'], grandparents: ['grandmother', 'grandfather'],
  spouse: ['wife', 'husband', 'partner'], hubby: ['husband'], wifey: ['wife'], 'significant other': ['wife', 'husband', 'partner', 'girlfriend', 'boyfriend', 'fiancee', 'fiance'],
  kid: ['son', 'daughter'], kids: ['son', 'daughter'], child: ['son', 'daughter'], children: ['son', 'daughter'],
  bro: ['brother'], sis: ['sister'], sibling: ['brother', 'sister'], siblings: ['brother', 'sister'],
  'in-law': ['mother-in-law', 'father-in-law', 'brother-in-law', 'sister-in-law', 'son-in-law', 'daughter-in-law'],
  'mom-in-law': ['mother-in-law'], 'mum-in-law': ['mother-in-law'], 'dad-in-law': ['father-in-law'],
  'parent-in-law': ['mother-in-law', 'father-in-law'],
  stepmom: ['stepmother'], stepmum: ['stepmother'], stepdad: ['stepfather'],
  auntie: ['aunt'], aunty: ['aunt'],
  neighbour: ['neighbor'], buddy: ['friend'], pal: ['friend'], mate: ['friend'], bestie: ['best friend'],
  coworker: ['colleague'], 'co-worker': ['colleague'], workmate: ['colleague'], manager: ['boss'], supervisor: ['boss'],
  physician: ['doctor'], gp: ['doctor'], dr: ['doctor'], veterinarian: ['vet'], sitter: ['babysitter'], minister: ['pastor'], priest: ['pastor'],
  fiance: ['fiance', 'fiancee'], fiancee: ['fiancee', 'fiance'],
};

/** A tie as it is kept and compared: lower case, "mother in law" and "mother in laws" as "mother-in-law". */
function tieOf(text) {
  let t = fold(text).replace(/[’']s\b|s[’']\B/g, '').replace(/[^a-z -]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:my|our|the)\s+/, '');
  t = t.replace(/[\s-]*in[\s-]*laws?$/, '-in-law').replace(/^step[\s-]+/, 'step').replace(/^grand[\s-]+/, 'grand').replace(/^god[\s-]+/, 'god');
  return t.slice(0, 40);
}
const KNOWN = new Map(Object.entries(TIES).flatMap(([g, ties]) => ties.map((t) => [t, g])));

/** The ties some wording can mean: itself when it is one, what its everyday word stands for, and a plural's singular. */
function tiesMeant(text) {
  const t = tieOf(text);
  if (!t) return [];
  for (const w of [t, t.replace(/s$/, ''), t.replace(/ies$/, 'y')]) {
    if (SAME[w]) return SAME[w];
    if (KNOWN.has(w)) return [w];
  }
  return [];
}
/** The group a tie belongs to when it is a known one, else ''. */
const groupOfTie = (tie) => { const m = tiesMeant(tie); return m.length ? KNOWN.get(m[0]) || '' : ''; };
/** A group meant by a word such as "family", "friends" or "neighbours", else ''. */
function groupMeant(text) {
  const t = fold(text).replace(/^(?:my|our|the)\s+/, '').trim();
  const words = { family: 'family', relatives: 'family', relations: 'family', friends: 'friends', friend: 'friends', work: 'work', colleagues: 'work', coworkers: 'work', neighbors: 'neighbors', neighbours: 'neighbors', neighbor: 'neighbors', neighbour: 'neighbors', doctors: 'care', care: 'care', medical: 'care' };
  return words[t] || '';
}
const pinName = (id) => (PINS.find((p) => p.id === id) || {}).name || '';
const groupName = (id) => (GROUPS.find((g) => g.id === id) || {}).name || '';

module.exports = { PINS, GROUPS, TIES, tieOf, tiesMeant, groupOfTie, groupMeant, pinName, groupName, fold };
