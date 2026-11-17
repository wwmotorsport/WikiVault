'use strict';
// Guided lessons: reading the steps of a lesson out of a teacher guide's page text.
// The pages here are written for the tests, in the layouts the real guides use.
const test = require('node:test');
const assert = require('node:assert/strict');
const { outline, readable } = require('../src/core/school-outline');
const school = require('../src/core/school');

const page = (...ls) => ls.join('\n');
const steps = (lesson) => lesson.steps.map((s) => [s.page + 1, s.minutes, s.group || '', s.title]);

test('language arts: parts of the lesson become groups, and the opening chart is not counted twice', () => {
  const pages = [
    page('Contents', 'Lesson 1 14', 'Lesson 2 30'),
    page('Lesson 1', 'Unit 2: Early Civilizations', 'Reading 45 min.', 'Read the Chapter 15 minutes', 'Word Work: Diverse 5 minutes'),
    page('READING 45 minutes', 'Read-Aloud: Chapter 3 “The Rise”', 'Introduce the Reader 5 minutes', 'Students open the Reader.'),
    page('Read the Chapter 15 minutes', 'Read aloud.', 'Activity Page 1.4 relates to Word Work: Diverse 5 minutes'),
    page('GRAMMAR 15 minutes', 'Subjects and predicates.', 'WRITING 15 minutes', 'Model Paraphrasing 10 minutes'),
    page('Lesson 2', 'Unit 2: Early Civilizations'),
    page('Reading 45 minutes', 'Review 5 minutes'),
    page('Pausing Point', 'Culminating Activities 30 minutes'),
  ];
  const [part] = outline(pages, 'ela');
  assert.deepEqual([...part.lessons.keys()], [1, 2]);
  const l1 = part.lessons.get(1);
  assert.deepEqual([l1.page + 1, l1.end, l1.chapter], [2, 5, 3]);
  assert.deepEqual(steps(l1), [
    [3, 5, 'Reading', 'Introduce the Reader'],
    [4, 15, 'Reading', 'Read the Chapter'],
    [4, 5, 'Reading', 'Word Work: Diverse'],
    [5, 15, '', 'Grammar'],                      // a part with nothing timed under it stands as a step
    [5, 10, 'Writing', 'Model Paraphrasing'],
  ]);
  assert.deepEqual(steps(part.lessons.get(2)), [[7, 5, 'Reading', 'Review']], 'the last lesson stops at the pausing point');
});

test('mathematics: warm-up, activities, synthesis and cool-down, with the timeline left out', () => {
  const pages = [
    page('Grade 5, Unit 1', 'Section A', 'Lesson 1: What Is Volume?', 'Standards Alignments'),
    page('Unit 1 Lesson 1', 'Grade 5, Unit 1', 'Lesson Timeline Teacher Reflection Question', 'Warm-up 10 min What did students understand', 'Activity 1 15 min', 'Activity 2 20 min', 'Lesson Synthesis 10 min', 'Cool-down 5 min', '5 min', 'Cool-down (to be completed at the end of the lesson)', 'Unit 1 Lesson 1 23'),
    page('Grade 5, Unit 1', 'Warm-up 10 min', 'Which One Doesn’t Belong: Cubes', 'Standards Alignments', 'Launch', '1 minute: quiet think time'),
    page('Unit 1 Lesson 1', '15 min', 'Activity 1', 'Build Objects', 'Student-facing Task Statement', 'Activity 2 20 min', 'Standards Alignments'),
    page('Grade 5, Unit 1', 'Lesson Synthesis 10 min', 'Display the objects.'),
    page('Unit 1 Lesson 2', 'Grade 5, Unit 1', 'Lesson 2: Measure Volume', 'Warm-up 10 min', 'Number Talk'),
    page('Lesson 1: What Is Volume?', 'Cool Down: Which Has More Volume?'),
  ];
  const [part] = outline(pages, 'math');
  const l1 = part.lessons.get(1);
  assert.deepEqual([l1.page + 1, l1.end, l1.title], [1, 5, 'What Is Volume?'], 'a lesson that starts on a left-hand page starts before its first running head');
  assert.deepEqual(steps(l1), [
    [3, 10, '', 'Warm-up: Which One Doesn’t Belong: Cubes'],
    [4, 15, '', 'Activity 1: Build Objects'],
    [4, 20, '', 'Activity 2'],
    [5, 10, '', 'Lesson synthesis: talk over what was learned'],
    [2, 5, '', 'Cool-down: a short task to check the lesson'],
  ]);
  assert.equal(part.lessons.get(2).page + 1, 6);
});

test('mathematics: headings whose letters did not survive are known by their shape and place', () => {
  assert.equal(readable('!/are More !and>ic/es'), false);
  assert.equal(readable('Share More Sandwiches'), true);
  const pages = [
    page('Unit 2 Lesson 1', 'Grade 5, Unit 2', 'Lesson : !/are !and>ic/es', '!tandards lign4ents'),
    page('Grade 5, Unit 2', '/arm-up \u000e min', '\u001ectivity 1 \u000e5 min', '\u001ectivity \u000e 15 min', '$esson Synthesis 10 min', '\u001cool-down 5 min'),
    page('Unit 2 Lesson 1', '/arm-up 10 min', '!otice and >onder'),
    page('Grade 5, Unit 2', '\u0013,ti?itB \b min', '!tudent-acing'),
    page('Unit 2 Lesson 1', '\u0013,ti?itB 5 min', '!tudent-acing "as2'),
    page('Grade 5, Unit 2', 'Lesson !?nt.esis 10 min'),
    page('Unit 2 Lesson 1', 'Lesson  : rea !ituations', '%ar4up 1 min'),   // lesson 2, printed under lesson 1's running head
    page('Unit 2 Lesson 3', 'Grade 5, Unit 2', 'Lesson : "/ird'),
    page('Lesson 1: Share Sandwiches', 'Cool Down: Share'),
    page('Lesson 2: Area Situations', 'Cool Down: Area'),
  ];
  const [part] = outline(pages, 'math');
  assert.deepEqual([...part.lessons.keys()].sort(), [1, 2, 3]);
  assert.deepEqual([part.lessons.get(1).title, part.lessons.get(2).title, part.lessons.get(2).page + 1], ['Share Sandwiches', 'Area Situations', 7], 'titles come from the cool-down sheets, which read');
  assert.deepEqual(steps(part.lessons.get(1)), [
    [3, 10, '', 'Warm-up'],
    [4, null, '', 'Activity 1'],
    [5, 5, '', 'Activity 2'],
    [6, 10, '', 'Lesson synthesis: talk over what was learned'],
    [2, 5, '', 'Cool-down: a short task to check the lesson'],
  ]);
});

test('history: the core lesson, the check, optional activities, and a book that holds two units', () => {
  const unitPages = (name) => [
    page('CHAPTER 1', `${name}:`, 'First Chapter', 'The Big Question: What do the ruins', 'tell you?', 'Primary Focus Objectives'),
    page('t he c ore l esson 35 min', 'Introduce “First Chapter” 5 min', 'CHAPTER 1 | FIRST CHAPTER 19'),
    page('Guided Reading Supports for “First Chapter” 25 min', 'c hec K for u nderst A ndin G 10 min', 'Additional Activities', 'World Geography (RI.5.7, RI.5.9) 10–20 min'),
    page('CHAPTER 2', 'Second Chapter', 'The Big Question: Why?'),
    page('Introduce “Second Chapter” 5 min'),
    page('UNIT 1', 'Teacher Resources', 'Unit Assessment'),
    page('Answer Key: ' + name, 'Unit Assessment', '1. b'),
  ];
  const pages = [page('Contents'), ...unitPages('The Maya'), ...unitPages('The Reformation')];
  const parts = outline(pages, 'hist');
  assert.equal(parts.length, 2);
  const l1 = parts[0].lessons.get(1);
  assert.deepEqual([l1.title, l1.question], ['The Maya: First Chapter', 'What do the ruins tell you?']);
  assert.deepEqual(steps(l1), [
    [3, 5, '', 'Introduce “First Chapter”'],
    [4, 25, '', 'Guided Reading Supports for “First Chapter”'],
    [4, 10, '', 'Check for understanding'],
    [4, 10, 'Additional activities (optional)', 'World Geography'],
  ]);
  assert.equal(parts[1].lessons.get(2).page + 1, 12);

  // The second unit's test and answers are its own, not the first unit's.
  const hist = { id: 'hist', name: 'History and Geography', minutes: 45 };
  const unit = { id: 'hist-u5', n: 5, title: 'The Reformation', part: 2, plan: { lessons: 2, word: 'Chapter' }, extra: [{ kind: 'assessment', title: 'Unit assessment', count: 1 }], files: [{ role: 'teacher', id: 'tg' }] };
  const sessions = school.unitSessions(hist, unit);
  const pagesOf = (id) => (id === 'tg' ? pages : null);
  assert.deepEqual(school.linksFor(sessions[0], unit, hist, pagesOf).map((l) => [l.label, l.page]), [['Lesson plan', 9], ['Answer key', 15]]);
  assert.deepEqual(school.linksFor(sessions[2], unit, hist, pagesOf).map((l) => [l.label, l.page]), [['The test', 14], ['Answer key', 15]]);
});

const sciPages = [
  page('Contents'),
  page('M ATERIALS AND E QUIPMENT', 'Lesson 1', '• cups'),
  page('LESSON 1', 'Introduction to Matter', 'Big Question: What is matter?', 'A T A G LANCE'),
  page('T HE C ORE L ESSON T WO D AYS , 45 MIN EACH', '1. Day 1: Focus student attention on the Big Question. 5 MIN', '2. Preview the investigation. 5 MIN', 'LESSON 1 | INTRODUCTION TO MATTER 23'),
  page('5. Monitor student progress. 5 MIN ( PER DAY )', '1. Day 2: Continue the investigation. 20 MIN', '2. Guide discussion. 5 MIN'),
  page('LESSON 2', 'Properties of Matter', 'Big Question: What properties can I use?', 'Student Reader, Chapter 1'),
  page('T HE C ORE L ESSON 45 MIN', '1. Focus student attention on the Big Question. 5 MIN', '2. Read together. 25 MIN'),
  page('Name Date', 'Unit Assessment (Page 1 of 2)', '1. What is matter?'),
  page('Answer Key', 'Unit Assessment', '1. Anything that has mass'),
];
const sci = { id: 'sci', name: 'Science', minutes: 45 };
const sciUnit = { id: 'sci-u1', n: 1, title: 'Investigating Matter', plan: { days: 4 }, files: [{ role: 'teacher', id: 'tg' }, { role: 'reader', id: 'sr' }] };
const reader = [page('Investigating Matter'), page('Properties of Matter', 'Chapter', '1', 'Matter is everywhere.')];
const sciText = (id) => (id === 'tg' ? sciPages : id === 'sr' ? reader : null);

test('science: a lesson the guide gives two days takes two days of the plan', () => {
  const [part] = outline(sciPages, 'sci');
  const l1 = part.lessons.get(1);
  assert.deepEqual([l1.page + 1, l1.days, l1.title, l1.question], [3, 2, 'Introduction to Matter', 'What is matter?'], 'the materials list that names "Lesson 1" is not the lesson');
  assert.deepEqual(l1.steps.map((s) => [s.day, s.title]), [[1, 'Focus student attention on the Big Question'], [1, 'Preview the investigation'], [1, 'Monitor student progress'], [2, 'Continue the investigation'], [2, 'Guide discussion']]);

  const days = school.unitSessions(sci, sciUnit);
  const guide = (k) => school.guideFor(days[k - 1], sciUnit, sci, sciText);
  const g2 = guide(2);
  assert.deepEqual([g2.title, g2.name, g2.question, g2.read], ['Lesson 1, day 2 of 2', 'Introduction to Matter', 'What is matter?', true]);
  assert.deepEqual(g2.steps.map((s) => [s.title, s.minutes, s.page]), [['Get ready', null, 3], ['Continue the investigation', 20, 5], ['Guide discussion', 5, 5], ['Check the work and finish', null, 9]]);
  const g3 = guide(3);
  assert.equal(g3.title, 'Lesson 2');
  assert.deepEqual(g3.links.map((l) => [l.label, l.page]), [['Lesson plan', 6], ['Reader', 2], ['Answer key', 9]], 'the reader opens at the chapter the lesson names');
  const g4 = guide(4);
  assert.equal(g4.title, 'Review and unit assessment');
  assert.deepEqual(g4.steps.map((s) => [s.title, s.page]), [['Review the unit', null], ['Give the unit assessment', 8], ['Check the work and finish', 9]]);
});

test('a lesson whose guide has not been read still has a beginning, a middle and an end', () => {
  const days = school.unitSessions(sci, sciUnit);
  const g = school.guideFor(days[0], sciUnit, sci, () => null);
  assert.equal(g.read, false);
  assert.deepEqual(g.steps.map((s) => s.title), ['Get ready', 'Teach the lesson', 'Check the work and finish']);
  assert.equal(g.steps.at(-1).kind, 'finish');
  // A lesson in parts, with nothing timed: each part is a step.
  const pages = [page('LESSON 1, PART 1', 'Computer Systems', 'Driving Question: What can I develop?'), page('text'), page('LESSON 1, PART 2', 'What Is a System?'), page('LESSON 2, PART 1', 'Communication')];
  const [part] = outline(pages, 'sci');
  assert.deepEqual(steps(part.lessons.get(1)), [[1, null, '', 'Part 1: Computer Systems'], [3, null, '', 'Part 2: What Is a System?']]);
  assert.equal(part.lessons.get(1).question, 'What can I develop?');
});
