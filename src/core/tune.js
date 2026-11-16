'use strict';
/**
 * Planning for "Tune for this computer". Pure functions: what to time, in what order, and what
 * the timings imply. Nothing here knows about any particular chip; every decision comes from the
 * builds Foundry Local offers for the machine and from speeds measured on it.
 */
const TARGET_TPS = 10;            // about the slowest writing speed that still reads comfortably

/**
 * The speed-against-thoroughness preference, 0 (fastest) to 4 (most thorough). Each step says how
 * slow the writing may be, how long the first word may take, and how long a full answer may take.
 * A slower allowance lets tuning choose a larger model, more article text and longer answers.
 */
const PROFILES = [
  { name: 'Fastest', targetTps: 25, firstWordS: 3, writeS: 20 },
  { name: 'Fast', targetTps: 15, firstWordS: 5, writeS: 30 },
  { name: 'Balanced', targetTps: TARGET_TPS, firstWordS: 8, writeS: 45 },
  { name: 'Thorough', targetTps: 6, firstWordS: 15, writeS: 75 },
  { name: 'Most thorough', targetTps: 3, firstWordS: 30, writeS: 120 },
];
const profile = (preference) => PROFILES[Math.min(4, Math.max(0, Math.round(Number(preference ?? 2))))] || PROFILES[2];
const DEVICE_ORDER = ['NPU', 'GPU', 'CPU'];
const BUDGETS = [3000, 6000, 10000];
const LENGTHS = [250, 400, 800];
const UNSUITABLE = /coder|code|vision|-vl\b|embed|whisper|guard|rerank|-4k\b/i; // the last: too little room for article text

/** Families that can answer from passages on this machine: plain chat models that fit in memory. */
function eligible(families, { ramMb } = {}) {
  const limit = ramMb ? ramMb * 0.5 : Infinity; // leave room for the system, the reader and the rest
  return (families || []).filter((f) => !UNSUITABLE.test(f.alias)).map((f) => ({
    ...f,
    // Models that think aloud before answering spend most of their words on the thinking.
    builds: f.builds.filter((b) => !b.reasoning && (!b.sizeMb || b.sizeMb <= limit)),
  })).filter((f) => f.builds.length);
}

const onDevice = (family, device) => family.builds.find((b) => b.device === device) || null;
const devicesOf = (families) => DEVICE_ORDER.filter((d) => families.some((f) => onDevice(f, d)));
const ok = (r) => Boolean(r && !r.error && r.tokensPerS > 0);

/**
 * What to time to compare the hardware: one family with a build for each kind of hardware here.
 * A family already timed on every device costs nothing; otherwise the smallest download wins.
 */
function pickProbe(families, tests = {}) {
  const devices = devicesOf(families);
  if (devices.length < 2) return null;
  const complete = families.filter((f) => devices.every((d) => onDevice(f, d)));
  const pool = complete.length ? complete : families.filter((f) => DEVICE_ORDER.filter((d) => onDevice(f, d)).length >= 2);
  if (!pool.length) return null;
  const builds = (f) => DEVICE_ORDER.map((d) => onDevice(f, d)).filter(Boolean);
  const timed = pool.find((f) => builds(f).every((b) => ok(tests[b.id])));
  const cost = (f) => builds(f).reduce((sum, b) => sum + (b.cached || ok(tests[b.id]) ? 0 : (b.sizeMb || 4000)), 0);
  const family = timed || [...pool].sort((a, b) => cost(a) - cost(b) || (a.sizeMb || 0) - (b.sizeMb || 0))[0];
  return { family, builds: builds(family) };
}

/** Families with a build for one device, smallest first: the ladder the model search climbs. */
function ladder(families, device) {
  return families.map((f) => ({ alias: f.alias, build: onDevice(f, device) })).filter((x) => x.build)
    .sort((a, b) => (a.build.sizeMb || 0) - (b.build.sizeMb || 0));
}

/** Writing speed falls roughly in proportion to model size on the same hardware. */
function estimateTps(known, sizeMb) {
  if (!known?.tokensPerS || !known.sizeMb || !sizeMb) return null;
  return known.tokensPerS * known.sizeMb / sizeMb;
}

/**
 * Which rung to time next, or null when enough is known. Starts at the largest model expected to
 * reach the target, then climbs while the target is met and steps down while it is not.
 * `measured` maps rung index to tokens a second (0 for a build that could not be timed).
 */
function nextRung(rungs, measured, { known = null, target = TARGET_TPS, maxTests = 3 } = {}) {
  if (!rungs.length) return null;
  if (!measured.size) {
    let start = 0;
    rungs.forEach((r, i) => { const est = estimateTps(known, r.build.sizeMb); if (est != null && est >= target) start = i; });
    return start;
  }
  // A model that could not be timed at all says nothing about speed: it is stepped over, and gets
  // up to two tries beyond the three that count.
  const failed = [...measured.entries()].filter(([, tps]) => !(tps > 0)).map(([i]) => i);
  const timed = [...measured.entries()].filter(([, tps]) => tps > 0).map(([i]) => i).sort((a, b) => a - b);
  if (timed.length >= maxTests || measured.size >= maxTests + Math.min(2, failed.length)) return null;
  const free = (i) => i >= 0 && i < rungs.length && !measured.has(i);
  const above = (from) => { for (let i = from + 1; i < rungs.length; i += 1) if (free(i)) return i; return null; };
  const below = (from) => { for (let i = from - 1; i >= 0; i -= 1) if (free(i)) return i; return null; };
  if (!timed.length) return below(Math.min(...failed)) ?? above(Math.max(...failed));
  const meeting = timed.filter((i) => measured.get(i) >= target);
  if (meeting.length) {
    const best = meeting.at(-1);
    if (timed.some((i) => i > best)) return null;   // a larger one was timed and was too slow: the edge is found
    // Room to try a better model, unless its size says it would plainly be too slow: a large
    // download is not worth making just to confirm that.
    const next = above(best);
    if (next == null) return null;
    const est = estimateTps({ tokensPerS: measured.get(best), sizeMb: rungs[best].build.sizeMb }, rungs[next].build.sizeMb);
    return est == null || est >= target * 0.85 ? next : null;
  }
  return below(timed[0]);                             // too slow so far: go smaller
}

/** The largest model that writes fast enough; failing that, the fastest one. */
function choose(rungs, measured, target = TARGET_TPS) {
  const timed = [...measured.entries()].filter(([, tps]) => tps > 0);
  if (!timed.length) return null;
  const fastEnough = timed.filter(([, tps]) => tps >= target).sort((a, b) => b[0] - a[0])[0];
  const index = fastEnough ? fastEnough[0] : timed.sort((a, b) => b[1] - a[1])[0][0];
  return { index, ...rungs[index], tokensPerS: measured.get(index), meetsTarget: Boolean(fastEnough) };
}

/**
 * Reading budget and answer length from two timings of the chosen model, one with little article
 * text and one with a lot. More text makes better-grounded answers but delays the first word and
 * slows the writing; the largest budget that stays usable is chosen.
 */
function recommendSettings(small, large, prefs = PROFILES[2]) {
  const { targetTps: target, firstWordS, writeS } = prefs;
  const at = (chars, key) => {
    if (!large || large.contextChars === small.contextChars) return small[key];
    const t = (chars - small.contextChars) / (large.contextChars - small.contextChars);
    return small[key] + t * (large[key] - small[key]);
  };
  // A machine already below a comfortable pace gets the smallest budget: more text only slows it further.
  const usable = (chars) => at(chars, 'firstS') <= firstWordS && at(chars, 'tokensPerS') >= target * 0.75;
  const contextChars = [...BUDGETS].reverse().find(usable) || BUDGETS[0];
  const tps = Math.max(at(contextChars, 'tokensPerS'), 0.1);
  const maxAnswerTokens = [...LENGTHS].reverse().find((n) => n / tps <= writeS) || LENGTHS[0];
  const round = (x) => Math.round(x * 10) / 10;
  return {
    contextChars, maxAnswerTokens,
    firstS: round(at(contextChars, 'firstS')), tokensPerS: round(tps), writeS: Math.round(maxAnswerTokens / tps),
  };
}

module.exports = { PROFILES, profile, TARGET_TPS, DEVICE_ORDER, BUDGETS, LENGTHS, eligible, pickProbe, ladder, estimateTps, nextRung, choose, recommendSettings, devicesOf };
