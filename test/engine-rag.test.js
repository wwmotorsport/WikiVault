'use strict';
// These tests run the real Kiwix reader engine against a small Wikipedia-shaped
// file. They are skipped when kiwix-serve is not installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Engine, probeZim, parseSearchXml } = require('../src/core/engine');
const { extractArticle } = require('../src/core/extract');
const { keywords, properPhrases, tokenize } = require('../src/core/rank');
const { retrieve, answerQuestion, buildMessages, standaloneQuestion, turnSources } = require('../src/core/rag');
const { LlmService } = require('../src/core/llm');
const { kiwixServePath, startModelServer, FIXTURES } = require('./helpers');

const bin = kiwixServePath();
const ZIM = path.join(FIXTURES, 'wikipedia_en_all_maxi_2026-11.zim');
const skip = bin ? false : 'kiwix-serve is not installed';

let engine;
test.before(async () => { if (bin) engine = await new Engine({ binPath: bin }).start(ZIM); });
test.after(async () => { await engine?.stop(); });

test('engine reports the edition it is serving', { skip }, () => {
  assert.equal(engine.zimName, 'wikipedia_en_all_maxi_2026-11');
  assert.equal(engine.info.articleCount, 7);
  assert.match(engine.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('title suggestions', { skip }, async () => {
  const hits = await engine.suggest('apol');
  assert.equal(hits[0].title, 'Apollo 11');
  assert.equal(hits[0].path, 'Apollo_11');
  assert.equal(engine.pathForUrl(hits[0].url), 'Apollo_11');
  assert.deepEqual(await engine.suggest('   '), []);
});

test('full-text search returns titles, links and highlighted snippets', { skip }, async () => {
  const res = await engine.search('moon landing 1969');
  assert.ok(res.total >= 2);
  const titles = res.items.map((i) => i.title);
  assert.ok(titles.includes('Apollo 11'));
  assert.ok(res.items[0].snippet.some((s) => s.hit), 'matches are marked');
  assert.ok(res.items.every((i) => i.url.startsWith(engine.origin) && i.path));
  assert.deepEqual((await engine.search('zzzqqqxyz')).items, []);
});

test('pages outside the offline copy are refused', { skip }, async () => {
  await assert.rejects(engine.fetchHtml('https://example.org/'), /Not a page in the offline copy/);
});

test('trial-open accepts a good file and rejects a broken one', { skip }, async () => {
  assert.equal((await probeZim(bin, ZIM)).ok, true);
  assert.equal((await probeZim(bin, __filename)).ok, false);
});

test('article text extraction drops references, scripts and tables', { skip }, async () => {
  const { text } = await engine.fetchHtml(engine.urlForPath('Apollo_11'));
  const art = extractArticle(text);
  assert.equal(art.title, 'Apollo 11');
  const all = art.chunks.map((c) => c.text).join('\n');
  assert.match(all, /first landed humans on the Moon/);
  assert.match(all, /Key facts: Type: Test article/);
  assert.doesNotMatch(all, /citation text that should be ignored|var a=1|\[1\]/);
  assert.equal(art.chunks[0].lead, true);
  const mission = art.chunks.find((c) => c.section === 'Mission');
  assert.equal(mission.anchor, 'Mission');
  assert.ok(!art.chunks.some((c) => c.section === 'References'));
});

test('keywords and proper names are pulled out of questions', () => {
  assert.deepEqual(keywords('Who was the first person to walk on the Moon?'), ['first', 'person', 'walk', 'Moon']);
  assert.deepEqual(properPhrases('What rocket launched Apollo 11 from Kennedy Space Center?'), ['Apollo 11', 'Kennedy Space Center']);
  assert.deepEqual(properPhrases('How does photosynthesis work?'), []);
  assert.deepEqual(tokenize('The engines were burning'), ['engine', 'burn']);
});

const QUESTIONS = [
  ['Who was the first person to walk on the Moon?', /Neil Armstrong/, /first person to walk on the Moon/],
  ['What rocket launched Apollo 11?', /Apollo 11|Saturn V/, /Saturn V/],
  ['How efficient is photosynthesis at converting light?', /Photosynthesis/, /3 to 6 percent/],
  ['Where did Neil Armstrong study engineering?', /Neil Armstrong/, /Purdue University/],
  ['How far is the Moon from Earth?', /Moon/, /384,400 km/],
  ['which engines did the first stage of the saturn v use', /Saturn V/, /five F-1 engines/],
  ['Who piloted the command module during the first Moon landing?', /Apollo 11/, /Michael Collins/],
];

for (const [q, titleRe, textRe] of QUESTIONS) {
  test(`retrieval finds the passage for: ${q}`, { skip }, async () => {
    const found = await retrieve(engine, q);
    assert.ok(found.passages.length > 0, `no passages (queries tried: ${found.queries.join(' | ')})`);
    const hit = found.passages.find((p) => textRe.test(p.text));
    assert.ok(hit, `answer text not among passages: ${found.passages.map((p) => `${p.title}/${p.section}`).join(', ')}`);
    assert.match(found.passages.map((p) => p.title).join(' '), titleRe);
    assert.ok(found.passages.every((p) => p.url.startsWith(engine.origin)));
    const total = found.passages.reduce((n, p) => n + p.text.length, 0);
    assert.ok(total <= 6500, `context stays within budget (${total} chars)`);
  });
}

test('a question with no match returns nothing rather than noise', { skip }, async () => {
  const found = await retrieve(engine, 'What is the boiling point of tungsten hexafluoride?');
  assert.equal(found.passages.length, 0);
});

test('"about the open article" pins that article', { skip }, async () => {
  const found = await retrieve(engine, 'When was it launched?', { pinnedUrl: engine.urlForPath('Saturn_V') });
  assert.equal(found.passages[0].title, 'Saturn V');
});

test('answers stream from the local model with numbered sources', { skip }, async () => {
  const model = await startModelServer({
    loaded: ['test-model'],
    reply: (messages) => {
      const user = messages.at(-1).content;
      if (!user.includes('Excerpts:')) return 'Neil Armstrong\nfirst Moon walk';
      const n = (/\[(\d+)\] Neil Armstrong/.exec(user) || [])[1] || '1';
      return `Neil Armstrong was the first person to walk on the Moon, in 1969 [${n}].`;
    },
  });
  try {
    const llm = new LlmService({ getSettings: () => ({ provider: 'custom', baseUrl: `${model.baseUrl}/v1`, model: 'test-model' }) });
    const tokens = [];
    const statuses = [];
    let sources = null;
    const out = await answerQuestion({
      engine, llm, question: 'Who was the first person to walk on the Moon?', editionDate: '2026-11',
      onToken: (t) => tokens.push(t), onStatus: (s) => statuses.push(s), onSources: (p) => { sources = p; },
    });
    assert.match(out.text, /Neil Armstrong was the first person/);
    assert.equal(tokens.join(''), out.text);
    assert.ok(tokens.length > 3, 'arrived as a stream');
    assert.ok(sources.length > 0);
    const cited = Number(/\[(\d+)\]/.exec(out.text)[1]);
    assert.equal(sources.find((s) => s.n === cited).title, 'Neil Armstrong');
    assert.deepEqual(statuses.slice(0, 2), ['Working out what to look up', 'Searching the offline copy']);
    const prompt = model.state.requests.at(-1);
    assert.match(prompt.messages[0].content, /November 2026 edition/);
    assert.match(prompt.messages[0].content, /Use only the numbered excerpts/);
    assert.equal(prompt.stream, true);
  } finally { await model.close(); }
});

test('without a model the passages are still returned', { skip }, async () => {
  const out = await answerQuestion({ engine, llm: null, question: 'What rocket launched Apollo 11?' });
  assert.equal(out.passagesOnly, true);
  assert.ok(out.passages.length > 0);
});

test('prompt lists excerpts with their numbers', () => {
  const msgs = buildMessages('Q?', [{ n: 1, title: 'A', section: 'S', text: 'alpha' }, { n: 2, title: 'B', section: '', text: 'beta' }], {});
  assert.match(msgs[1].content, /\[1\] A, section "S"\nalpha\n\n\[2\] B\nbeta\n\nQuestion: Q\?/);
});

test('search XML with odd content is parsed safely', () => {
  const xml = '<opensearch:totalResults>1</opensearch:totalResults><item><title>AT&amp;T</title><link>/content/z/AT%26T</link><description>a <b>hit</b> &lt;script&gt;x&lt;/script&gt;</description><book><title>Book</title></book><wordCount>5</wordCount></item>';
  const r = parseSearchXml(xml);
  assert.equal(r.items[0].title, 'AT&T');
  assert.deepEqual(r.items[0].snippet, [{ text: 'a ', hit: false }, { text: 'hit', hit: true }, { text: ' <script>x</script>', hit: false }]);
});

test('result counts written with thousands separators are read correctly', () => {
  // Seen on the full English edition: <opensearch:totalResults>84,809</opensearch:totalResults>.
  // Reading that as "no results" made every common search word look like it matched nothing.
  const item = '<item><title>Differential equation</title><link>/content/z/Differential_equation</link><description>x</description><wordCount>12,345</wordCount></item>';
  for (const [written, expected] of [['84,809', 84809], ['84.809', 84809], ['84\u00a0809', 84809], ['1,234,567', 1234567], ['7', 7], ['', 0]]) {
    const r = parseSearchXml(`<opensearch:totalResults>${written}</opensearch:totalResults>${item}`);
    assert.equal(r.total, expected, written);
    assert.equal(r.items[0].words, 12345);
  }
});

test('extraction copes with the markup real Wikipedia editions use', () => {
  // Shape produced by the Kiwix packager: Parsoid sections, collapsible <details>, mw-ref citations.
  const html = `<!DOCTYPE html><html><head><title>Tungsten</title><style>.a{}</style></head><body class="mw-body">
  <h1 id="titleHeading" class="article-header">Tungsten</h1>
  <div id="mw-content-text" class="mw-content-ltr mw-parser-output">
   <section data-mw-section-id="0" id="mf-section-0">
    <div class="shortdescription nomobile noexcerpt noprint">Chemical element</div>
    <div role="note" class="hatnote navigation-not-searchable">"Wolfram" redirects here.</div>
    <table class="infobox"><tbody><tr><th colspan="2">Tungsten</th></tr><tr><th scope="row">Atomic number</th><td>74</td></tr><tr><th scope="row">Melting point</th><td>3695 K &#8203;(3422 °C)</td></tr></tbody></table>
    <p><b>Tungsten</b> (also called <b>wolfram</b>)<sup class="mw-ref reference" id="cite_ref-1"><a href="#cite_note-1"><span class="mw-reflink-text">[1]</span></a></sup> is a <a href="Chemical_element" title="Chemical element">chemical element</a> with the symbol&nbsp;W and atomic number 74.</p>
    <figure typeof="mw:File/Thumb"><a href="x"><img src="../I/w.jpg"></a><figcaption>Tungsten rods</figcaption></figure>
   </section>
   <details data-level="2" open=""><summary class="section-heading"><h2 id="Characteristics">Characteristics</h2></summary>
    <details data-level="3" open=""><summary class="section-heading"><h3 id="Physical_properties">Physical properties</h3></summary>
     <p>In its raw form, tungsten is a hard steel-grey metal that is often brittle and hard to work. Of all metals in pure form, tungsten has the highest melting point (3,422&nbsp;°C).<sup class="mw-ref reference"><a href="#cite_note-2"><span class="mw-reflink-text">[2]</span></a></sup></p>
     <ul><li>Density of 19.254 g/cm3, comparable with that of uranium and gold.</li><li>x</li></ul>
     <table class="wikitable"><tbody><tr><th>Isotope</th><td>W-184 and a long row of numbers that should not be read</td></tr></tbody></table>
    </details>
   </details>
   <details data-level="2" open=""><summary class="section-heading"><h2 id="See_also">See also</h2></summary><ul><li><a href="Field_emission_gun">Field emission gun and other things</a></li></ul></details>
   <details data-level="2" open=""><summary class="section-heading"><h2 id="References">References</h2></summary>
    <div class="mw-references-wrap"><ol class="mw-references references"><li id="cite_note-1">A very long reference that must never reach the model.</li></ol></div></details>
   <div role="navigation" class="navbox"><table><tbody><tr><td>Periodic table navigation box with hundreds of links</td></tr></tbody></table></div>
  </div><script>window.x = 1</script></body></html>`;
  const art = extractArticle(html);
  assert.equal(art.title, 'Tungsten');
  const lead = art.chunks[0];
  assert.equal(lead.lead, true);
  assert.match(lead.text, /^Tungsten \(also called wolfram\) is a chemical element with the symbol W and atomic number 74\./);
  assert.match(lead.text, /Key facts: Atomic number: 74; Melting point: 3695 K/);
  const phys = art.chunks.find((c) => c.section === 'Characteristics, Physical properties');
  assert.ok(phys, art.chunks.map((c) => c.section).join(' | '));
  assert.equal(phys.anchor, 'Physical_properties');
  assert.match(phys.text, /highest melting point \(3,422 °C\)\. Density of 19\.254/);
  const all = art.chunks.map((c) => c.text).join('\n');
  assert.doesNotMatch(all, /redirects here|Chemical element$|Tungsten rods|long row of numbers|Field emission|never reach the model|navigation box|window\.x|\[\d\]/m);
});

// ---- conversation memory ----

const armstrongTurn = () => ({
  question: 'Who was the first person to walk on the Moon?',
  standalone: 'Who was the first person to walk on the Moon?',
  answer: 'Neil Armstrong was the first person to walk on the Moon, in 1969 [1].',
  sources: [{ title: 'Neil Armstrong', url: engine.urlForPath('Neil_Armstrong') }],
});

test('a follow-up is rewritten from the conversation, searched, and answered with history in view', { skip }, async () => {
  const model = await startModelServer({
    loaded: ['m'],
    reply: (messages) => {
      const sys = messages[0].content;
      const user = messages.at(-1).content;
      if (/Rewrite the latest question/.test(sys)) return 'Where did Neil Armstrong study engineering?';
      if (/search queries/.test(sys)) return 'Neil Armstrong education';
      const n = (/\[(\d+)\] Neil Armstrong, section "Early life"/.exec(user) || [0, '1'])[1];
      return `He studied aeronautical engineering at Purdue University [${n}].`;
    },
  });
  try {
    const llm = new LlmService({ getSettings: () => ({ provider: 'custom', baseUrl: `${model.baseUrl}/v1`, model: 'm' }) });
    let understood = null;
    const out = await answerQuestion({
      engine, llm, question: 'Where did he study engineering?', history: [armstrongTurn()], editionDate: '2026-11',
      onUnderstood: (t) => { understood = t; },
    });
    assert.equal(out.standalone, 'Where did Neil Armstrong study engineering?');
    assert.equal(understood, out.standalone);
    assert.match(out.text, /Purdue University/);
    assert.ok(out.passages.some((p) => /Purdue University/.test(p.text)));

    const [rewrite, , final] = model.state.requests;
    assert.match(rewrite.messages[1].content, /Q: Who was the first person to walk on the Moon\?\nA: Neil Armstrong was the first person to walk on the Moon, in 1969\.\n\nLatest question: Where did he study engineering\?/);
    const roles = final.messages.map((m) => m.role);
    assert.deepEqual(roles, ['system', 'user', 'assistant', 'user']);
    assert.equal(final.messages[1].content, 'Who was the first person to walk on the Moon?');
    assert.equal(final.messages[2].content, 'Neil Armstrong was the first person to walk on the Moon, in 1969.', 'old citation numbers are removed');
    assert.match(final.messages[3].content, /Question: Where did he study engineering\?\n\(Meaning: Where did Neil Armstrong study engineering\?\)$/);
    assert.match(final.messages[0].content, /Earlier questions and answers are included/);
  } finally { await model.close(); }
});

test('a first question is not rewritten and carries no history', { skip }, async () => {
  const model = await startModelServer({ loaded: ['m'], reply: (messages) => (/search queries/.test(messages[0].content) ? 'Moon distance' : 'About 384,400 km [1].') });
  try {
    const llm = new LlmService({ getSettings: () => ({ provider: 'custom', baseUrl: `${model.baseUrl}/v1`, model: 'm' }) });
    const out = await answerQuestion({ engine, llm, question: 'How far is the Moon from Earth?', history: [] });
    assert.equal(out.standalone, 'How far is the Moon from Earth?');
    assert.equal(model.state.requests.length, 2, 'no rewrite call');
    assert.deepEqual(model.state.requests[1].messages.map((m) => m.role), ['system', 'user']);
    assert.doesNotMatch(model.state.requests[1].messages[0].content, /Earlier questions/);
  } finally { await model.close(); }
});

test('without a model, a follow-up still stays on the article the last answer used', { skip }, async () => {
  const alone = await answerQuestion({ engine, llm: null, question: 'Tell me more about him' });
  assert.equal(alone.empty, true, 'nothing to search for on its own');
  const followUp = await answerQuestion({ engine, llm: null, question: 'Tell me more about him', history: [armstrongTurn()] });
  assert.equal(followUp.passagesOnly, true);
  assert.equal(followUp.passages[0].title, 'Neil Armstrong');
});

test('a follow-up that names a new subject is not dragged back to the old one', { skip }, async () => {
  const out = await answerQuestion({ engine, llm: null, question: 'How efficient is Photosynthesis?', history: [armstrongTurn()] });
  assert.equal(out.passages[0].title, 'Photosynthesis');
});

test('a failed or rambling rewrite falls back to the question as asked', async () => {
  const history = [{ question: 'Q1?', answer: 'A1 [1].', sources: [] }];
  const failing = { chat: async () => { throw new Error('model offline'); } };
  assert.equal(await standaloneQuestion(failing, 'And then?', history), 'And then?');
  const rambling = { chat: async () => 'x'.repeat(400) };
  assert.equal(await standaloneQuestion(rambling, 'And then?', history), 'And then?');
  const labelled = { chat: async () => 'Rewritten question: "What happened after Q1?"\nExtra chatter' };
  assert.equal(await standaloneQuestion(labelled, 'And then?', history), 'What happened after Q1?');
  const never = { chat: async () => { throw new Error('should not be called'); } };
  assert.equal(await standaloneQuestion(never, 'First question?', []), 'First question?');
});

test('only the last three turns reach the model, and passage-only turns are skipped', () => {
  const history = [1, 2, 3, 4, 5].map((i) => ({ question: `Q${i}?`, answer: i === 4 ? '' : `A${i} [${i}].`, sources: [] }));
  const msgs = buildMessages('Q6?', [{ n: 1, title: 'T', section: '', text: 'x' }], { history });
  assert.deepEqual(msgs.map((m) => m.content).slice(1, -1), ['Q3?', 'A3.', 'Q5?', 'A5.']);
  const long = buildMessages('Q?', [{ n: 1, title: 'T', section: '', text: 'x' }], { history: [{ question: 'Q0?', answer: 'word '.repeat(300) }] });
  assert.ok(long[2].content.length <= 501);
});

test('a turn remembers the articles it cited', () => {
  const passages = [
    { n: 1, title: 'Apollo 11', url: 'http://127.0.0.1:1/content/z/Apollo_11' },
    { n: 2, title: 'Apollo 11', url: 'http://127.0.0.1:1/content/z/Apollo_11#Mission' },
    { n: 3, title: 'Saturn V', url: 'http://127.0.0.1:1/content/z/Saturn_V#Design' },
    { n: 4, title: 'Moon', url: 'http://127.0.0.1:1/content/z/Moon' },
  ];
  assert.deepEqual(turnSources('Launched by a Saturn V [2, 3].', passages).map((s) => s.title), ['Apollo 11', 'Saturn V']);
  assert.deepEqual(turnSources('', passages).map((s) => s.url), ['http://127.0.0.1:1/content/z/Apollo_11']);
});

test('the prompt names the library that is open', () => {
  const p = [{ n: 1, title: 'T', section: '', text: 'x' }];
  assert.match(buildMessages('Q?', p, {})[0].content, /offline copy of English Wikipedia\./);
  assert.match(buildMessages('Q?', p, { source: 'Wikibooks', editionDate: '2026-10' })[0].content, /offline copy of English Wikibooks \(the October 2026 edition\)/);
});
