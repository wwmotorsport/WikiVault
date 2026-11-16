'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { eligible, pickProbe, ladder, estimateTps, nextRung, choose, recommendSettings, devicesOf, profile, PROFILES } = require('../src/core/tune');

const b = (id, device, sizeMb, extra = {}) => ({ id, device, sizeMb, cached: false, ...extra });
const fam = (alias, ...builds) => ({ alias, builds, sizeMb: Math.min(...builds.map((x) => x.sizeMb)) });
// Shaped like Foundry Local's catalogue on a laptop with an NPU and an integrated GPU.
const NPU_LAPTOP = [
  fam('qwen2.5-0.5b', b('q05-npu', 'NPU', 520), b('q05-gpu', 'GPU', 480), b('q05-cpu', 'CPU', 800)),
  fam('qwen2.5-1.5b', b('q15-gpu', 'GPU', 1546), b('q15-cpu', 'CPU', 1822)),
  fam('phi-4-mini', b('phi-npu', 'NPU', 3686, { cached: true }), b('phi-gpu', 'GPU', 3809, { cached: true }), b('phi-cpu', 'CPU', 4915)),
  fam('qwen2.5-7b', b('q7-npu', 'NPU', 5324), b('q7-gpu', 'GPU', 5324), b('q7-cpu', 'CPU', 6307)),
  fam('phi-4', b('phi4-gpu', 'GPU', 8570), b('phi4-cpu', 'CPU', 10403)),
  fam('deepseek-r1-7b', b('ds-gpu', 'GPU', 5300, { reasoning: true }), b('ds-cpu', 'CPU', 6000, { reasoning: true })),
  fam('qwen2.5-coder-7b', b('qc-gpu', 'GPU', 5300)),
  fam('qwen2.5-14b', b('q14-gpu', 'GPU', 9800), b('q14-cpu', 'CPU', 11000)),
];

test('only plain chat models that fit in memory are considered', () => {
  const on32 = eligible(NPU_LAPTOP, { ramMb: 32000 }).map((f) => f.alias);
  assert.deepEqual(on32, ['qwen2.5-0.5b', 'qwen2.5-1.5b', 'phi-4-mini', 'qwen2.5-7b', 'phi-4', 'qwen2.5-14b']);
  const on8 = eligible(NPU_LAPTOP, { ramMb: 8000 });
  assert.deepEqual(on8.map((f) => f.alias), ['qwen2.5-0.5b', 'qwen2.5-1.5b', 'phi-4-mini']);
  assert.deepEqual(on8[2].builds.map((x) => x.device), ['NPU', 'GPU'], 'the 4.9 GB CPU build is too big for 8 GB');
});

test('hardware is compared on a family already timed everywhere, else on the cheapest download', () => {
  const families = eligible(NPU_LAPTOP, { ramMb: 32000 });
  assert.deepEqual(devicesOf(families), ['NPU', 'GPU', 'CPU']);
  assert.equal(pickProbe(families).family.alias, 'qwen2.5-0.5b', 'smallest download that covers every device');
  const tests = { 'phi-npu': { tokensPerS: 2.2 }, 'phi-gpu': { tokensPerS: 15.4 }, 'phi-cpu': { tokensPerS: 4 } };
  assert.equal(pickProbe(families, tests).family.alias, 'phi-4-mini', 'no new downloads needed');
  const cpuOnly = [fam('phi-4-mini', b('phi-cpu', 'CPU', 4915)), fam('qwen2.5-1.5b', b('q15-cpu', 'CPU', 1822))];
  assert.equal(pickProbe(cpuOnly), null, 'one kind of hardware: nothing to compare');
  const nvidia = [fam('phi-4-mini', b('p-cuda', 'GPU', 3800), b('p-cpu', 'CPU', 4900)), fam('qwen2.5-0.5b', b('q-cuda', 'GPU', 500), b('q-cpu', 'CPU', 800))];
  assert.deepEqual(pickProbe(nvidia).builds.map((x) => x.id), ['q-cuda', 'q-cpu']);
});

test('the model search starts where the estimate says, climbs while fast enough, and stops at the edge', () => {
  const rungs = ladder(eligible(NPU_LAPTOP, { ramMb: 32000 }), 'GPU');
  assert.deepEqual(rungs.map((r) => r.alias), ['qwen2.5-0.5b', 'qwen2.5-1.5b', 'phi-4-mini', 'qwen2.5-7b', 'phi-4', 'qwen2.5-14b']);
  const known = { tokensPerS: 15.4, sizeMb: 3809 }; // phi-4-mini on the GPU, as measured on a test laptop
  assert.ok(Math.abs(estimateTps(known, 5324) - 11.0) < 0.1);
  const measured = new Map();
  assert.equal(nextRung(rungs, measured, { known }), 3, 'qwen2.5-7b is the largest expected to reach 10 a second');
  measured.set(3, 8.1);   // slower than estimated
  assert.equal(nextRung(rungs, measured, { known }), 2, 'step down');
  measured.set(2, 15.4);
  assert.equal(nextRung(rungs, measured, { known }), null, 'the edge is found');
  assert.deepEqual([choose(rungs, measured).alias, choose(rungs, measured).meetsTarget], ['phi-4-mini', true]);

  const quick = new Map([[3, 14]]);
  assert.equal(nextRung(rungs, quick, { known }), 4, 'fast enough: try the next size up');
  quick.set(4, 9);
  assert.equal(nextRung(rungs, quick, { known }), null);
  assert.equal(choose(rungs, quick).alias, 'qwen2.5-7b');

  const slow = new Map([[0, 3]]);
  assert.equal(nextRung(rungs, slow, {}), null, 'nothing smaller to try');
  assert.deepEqual([choose(rungs, slow).alias, choose(rungs, slow).meetsTarget], ['qwen2.5-0.5b', false], 'nothing is fast enough: take the fastest');
  assert.equal(nextRung(rungs, new Map(), {}), 0, 'with no estimate, start small');
  assert.equal(nextRung(rungs, new Map([[1, 20], [2, 15], [3, 12]]), {}), null, 'never more than three timed models');
  assert.equal(choose(rungs, new Map([[2, 0]])), null);
});

test('reading budget and answer length follow the measured speed', () => {
  // A test laptop's GPU: quick to start, writes at a comfortable pace.
  const gpu = recommendSettings({ contextChars: 3000, firstS: 2.8, tokensPerS: 15.4 }, { contextChars: 10000, firstS: 9.5, tokensPerS: 12 });
  assert.deepEqual([gpu.contextChars, gpu.maxAnswerTokens], [6000, 400]);
  assert.ok(gpu.firstS > 5 && gpu.firstS < 6.5 && gpu.writeS < 45);
  // A test laptop's NPU: 2.2 a second falling to 1.5. Keep everything small.
  const npu = recommendSettings({ contextChars: 3000, firstS: 2.3, tokensPerS: 2.2 }, { contextChars: 10000, firstS: 7, tokensPerS: 1.2 });
  assert.deepEqual([npu.contextChars, npu.maxAnswerTokens], [3000, 250]);
  // A desktop with a strong GPU: everything large.
  const fast = recommendSettings({ contextChars: 3000, firstS: 0.3, tokensPerS: 90 }, { contextChars: 10000, firstS: 0.9, tokensPerS: 80 });
  assert.deepEqual([fast.contextChars, fast.maxAnswerTokens], [10000, 800]);
  // Only one timing available.
  assert.equal(recommendSettings({ contextChars: 3000, firstS: 2, tokensPerS: 20 }, null).contextChars, 10000);
});

test('a model that cannot be timed is stepped over, not mistaken for a slow one', () => {
  const rungs = ladder(eligible(NPU_LAPTOP, { ramMb: 32000 }), 'GPU');
  // What happened on a test laptop: the first pick failed outright, so the next smaller one was tried.
  const first = new Map([[4, 0]]);
  assert.equal(nextRung(rungs, first, {}), 3);
  first.set(3, 10.8);
  assert.equal(nextRung(rungs, first, {}), null, 'fast enough; the next size up after the failed one would plainly be too slow (about 6 a second), so it is not downloaded');
  assert.equal(choose(rungs, first).alias, 'qwen2.5-7b');
  // Climbing past a failure.
  const climb = new Map([[2, 30], [3, 0]]);
  assert.equal(nextRung(rungs, climb, {}), 4, 'estimated 13 a second: worth trying');
  assert.equal(nextRung(rungs, new Map([[2, 15], [3, 0]]), {}), null, 'estimated under 7 a second: not worth an 8 GB download');
  // Failures do not go on for ever.
  assert.equal(nextRung(rungs, new Map([[5, 0], [4, 0], [3, 0], [2, 0], [1, 0]]), {}), null);
  assert.equal(nextRung(rungs, new Map([[0, 0]]), {}), 1, 'the smallest failed: try the next one up');
});

test('the speed-or-thoroughness preference moves every target together', () => {
  assert.deepEqual(PROFILES.map((p) => p.name), ['Fastest', 'Fast', 'Balanced', 'Thorough', 'Most thorough']);
  assert.equal(profile(undefined).name, 'Balanced');
  assert.equal(profile(9).name, 'Most thorough');
  assert.equal(profile(-1).name, 'Fastest');
  const rungs = ladder(eligible(NPU_LAPTOP, { ramMb: 32000 }), 'GPU');
  const known = { tokensPerS: 10.8, sizeMb: 5324 }; // qwen2.5-7b on a test laptop's GPU
  const startFor = (pref) => rungs[nextRung(rungs, new Map(), { known, target: profile(pref).targetTps })].alias;
  assert.deepEqual([0, 1, 2, 3, 4].map(startFor), ['qwen2.5-1.5b', 'phi-4-mini', 'qwen2.5-7b', 'phi-4', 'qwen2.5-14b']);
  // A test laptop's measured figures for qwen2.5-7b: 5.1 s to the first word at 3,000 characters, 28 s at 10,000.
  const small = { contextChars: 3000, firstS: 5.1, tokensPerS: 10.8 };
  const large = { contextChars: 10000, firstS: 28, tokensPerS: 10.3 };
  assert.deepEqual([recommendSettings(small, large, profile(2)).contextChars, recommendSettings(small, large, profile(2)).maxAnswerTokens], [3000, 400]);
  assert.deepEqual([recommendSettings(small, large, profile(3)).contextChars, recommendSettings(small, large, profile(3)).maxAnswerTokens], [6000, 400]);
  assert.deepEqual([recommendSettings(small, large, profile(4)).contextChars, recommendSettings(small, large, profile(4)).maxAnswerTokens], [10000, 800]);
  assert.deepEqual([recommendSettings(small, large, profile(0)).contextChars, recommendSettings(small, large, profile(0)).maxAnswerTokens], [3000, 250]);
});
