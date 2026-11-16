'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { LlmService, matchModel, deviceFromModelId, fastest } = require('../src/core/llm');
const { startModelServer, tmpDir } = require('./helpers');

const NPU_ID = 'phi-4-mini-instruct-vitis-npu:2';
const skipCli = process.platform === 'win32' ? 'fake CLI is a POSIX script' : false;

async function foundryFixture(group, { running = false, cached = [] } = {}) {
  const dir = await tmpDir();
  const model = await startModelServer({ reply: () => 'Hello from the NPU.' });
  const loadedFile = path.join(dir, 'loaded.json');
  fs.writeFileSync(loadedFile, '[]');
  // The fake server reads "loaded models" from the same file the fake CLI writes.
  Object.defineProperty(model.state, 'loaded', { get: () => JSON.parse(fs.readFileSync(loadedFile, 'utf8')), set: (v) => fs.writeFileSync(loadedFile, JSON.stringify(v)) });
  model.state.known = [NPU_ID];
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ group, running, url: model.baseUrl, catalog: { 'phi-4-mini': NPU_ID }, cached, loadedFile }));
  process.env.FAKE_FOUNDRY_STATE = stateFile;
  process.env.WIKIVAULT_FOUNDRY_CLI = path.join(__dirname, 'fake-foundry.js');
  process.env.WIKIVAULT_FOUNDRY_HOME = dir; // never the real ~/.foundry
  const settings = { provider: 'foundry', foundryModel: 'phi-4-mini' };
  const llm = new LlmService({ getSettings: () => settings, saveSettings: (p) => Object.assign(settings, p) });
  const calls = () => JSON.parse(fs.readFileSync(stateFile, 'utf8')).calls || [];
  const done = async () => { await model.close(); await fsp.rm(dir, { recursive: true, force: true }); delete process.env.WIKIVAULT_FOUNDRY_CLI; };
  return { llm, model, settings, calls, done, loadedFile, dir, stateFile };
}

test('Foundry Local, current CLI: starts the service, downloads and loads the model, answers on the NPU', { skip: skipCli }, async () => {
  const f = await foundryFixture('server');
  try {
    const statuses = [];
    await assert.rejects(f.llm.prepare(), (e) => e.code === 'MODEL_NOT_DOWNLOADED', 'never downloads a model unless asked to');
    assert.equal(f.llm.status().state, 'needs-model');
    const ready = await f.llm.prepare({ allowDownload: true, onStatus: (s) => statuses.push(s) });
    assert.equal(ready.modelId, NPU_ID);
    assert.equal(ready.device, 'NPU');
    assert.deepEqual(f.calls(), ['server status', 'server start', 'model load phi-4-mini', 'server status', 'model load phi-4-mini', 'model download phi-4-mini', 'model load phi-4-mini']);
    assert.ok(statuses.some((s) => /Downloading the model/.test(s)));
    assert.equal(f.settings.foundryModelId, NPU_ID, 'exact model id remembered for offline starts');

    const tokens = [];
    const text = await f.llm.chat({ messages: [{ role: 'user', content: 'hi' }], onToken: (t) => tokens.push(t) });
    assert.equal(text, 'Hello from the NPU.');
    assert.equal(f.model.state.requests[0].model, NPU_ID);
    assert.equal(f.llm.status().state, 'ready');
    assert.equal(f.llm.status().device, 'NPU');
  } finally { await f.done(); }
});

test('Foundry Local, older CLI spelling ("service") is detected', { skip: skipCli }, async () => {
  const f = await foundryFixture('service', { running: true, cached: [NPU_ID] });
  try {
    const ready = await f.llm.prepare();
    assert.equal(ready.modelId, NPU_ID);
    assert.deepEqual(f.calls(), ['server status', 'service status', 'model load phi-4-mini']);
  } finally { await f.done(); }
});

test('a remembered model is loaded by exact id without touching the catalog', { skip: skipCli }, async () => {
  const f = await foundryFixture('server', { running: true, cached: [NPU_ID] });
  try {
    Object.assign(f.settings, { foundryModelId: NPU_ID, foundryModelFor: 'phi-4-mini' });
    const ready = await f.llm.prepare();
    assert.equal(ready.modelId, NPU_ID);
    assert.deepEqual(f.calls(), ['server status'], 'no CLI model commands were needed');
  } finally { await f.done(); }
});

test('reconnects once when the model was unloaded while idle', { skip: skipCli }, async () => {
  const f = await foundryFixture('server', { running: true, cached: [NPU_ID] });
  try {
    await f.llm.prepare();
    f.model.state.failNext = 1;
    const text = await f.llm.chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(text, 'Hello from the NPU.');
  } finally { await f.done(); }
});

// What happened on a real install: the model was set up, sat idle past Foundry Local's time-to-live,
// and the next question got HTTP 400 "must be loaded before inference" while the service still
// listed the model as loaded.
async function strictFixture(extra = {}) {
  const f = await foundryFixture('service', { running: true, cached: [NPU_ID] });
  const engineFile = path.join(path.dirname(f.loadedFile), 'engine.json');
  fs.writeFileSync(engineFile, '[]');
  Object.assign(f.model.state, { strict: true, engineFile }, extra.server);
  const stateFile = process.env.FAKE_FOUNDRY_STATE;
  fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile, 'utf8')), engineFile, ...extra.cli }));
  const unloadQuietly = () => fs.writeFileSync(engineFile, '[]'); // gone from memory, still on the "loaded" list
  return { ...f, engineFile, unloadQuietly };
}

test('a model unloaded while idle is loaded again and the question is answered', { skip: skipCli }, async () => {
  const f = await strictFixture();
  try {
    await f.llm.prepare();
    f.unloadQuietly();
    const statuses = [];
    const text = await f.llm.chat({ messages: [{ role: 'user', content: 'hi' }], onStatus: (s) => statuses.push(s) });
    assert.equal(text, 'Hello from the NPU.');
    assert.ok(statuses.some((s) => /Loading the model into memory/.test(s)), statuses.join(' | '));
    assert.equal(f.model.state.loadRequests.at(-1), `/openai/load/${encodeURIComponent(NPU_ID)}?ttl=3600`, 'older versions are asked to keep it for an hour');
  } finally { await f.done(); }
});

test('a fresh start trusts nothing: a model only listed as loaded is loaded for real before the first question', { skip: skipCli }, async () => {
  const f = await strictFixture();
  try {
    f.model.state.loaded = [NPU_ID]; // the list says loaded; the engine has nothing
    const text = await f.llm.chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(text, 'Hello from the NPU.');
    assert.equal(f.model.state.requests.length, 1, 'answered on the first attempt, with no failed request first');
  } finally { await f.done(); }
});

test('if the service refuses the load request, the command line loads the model instead', { skip: skipCli }, async () => {
  const f = await strictFixture({ server: { restLoad: false } });
  try {
    await f.llm.prepare();
    f.unloadQuietly();
    const text = await f.llm.chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(text, 'Hello from the NPU.');
    const calls = f.calls();
    assert.ok(calls.includes(`model load ${NPU_ID}`), calls.join(' | '));
  } finally { await f.done(); }
});

test('a model that will not stay loaded ends with advice instead of a bare HTTP error', { skip: skipCli }, async () => {
  const f = await strictFixture({ server: { restLoad: false } });
  try {
    await f.llm.prepare();
    fs.writeFileSync(process.env.FAKE_FOUNDRY_STATE, JSON.stringify({ ...JSON.parse(fs.readFileSync(process.env.FAKE_FOUNDRY_STATE, 'utf8')), engineFile: null }));
    f.unloadQuietly();
    await assert.rejects(f.llm.chat({ messages: [{ role: 'user', content: 'hi' }] }), /would not keep the model loaded.*foundry service restart.*must be loaded before inference/s);
    assert.equal(f.model.state.requests.length, 3, 'tried, loaded, tried, unloaded and loaded harder, tried');
    assert.equal(f.model.state.unloads, 1);
  } finally { await f.done(); }
});

// Foundry Local 0.14 as found on a real install (daemon 0.14.0, SDK 2.4.1): different routes, and
// /v1/models lists the whole catalog. 0.7.0 took that list for "loaded" and never downloaded the model.
async function v014Fixture({ cached = [], daemonFile = true } = {}) {
  const f = await foundryFixture('service', { running: true, cached });
  const engineFile = path.join(f.dir, 'engine.json');
  fs.writeFileSync(engineFile, '[]');
  Object.assign(f.model.state, { api: 'v2', engineFile, cliStateFile: f.stateFile, catalogIds: ['Phi-4-generic-gpu:2', NPU_ID, 'phi-4-mini-instruct-generic-cpu:5', 'openai-whisper-base-generic-cpu:3'] });
  fs.writeFileSync(f.stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(f.stateFile, 'utf8')), engineFile }));
  if (daemonFile) fs.writeFileSync(path.join(f.dir, 'daemon.json'), JSON.stringify({ pid: 1, web_urls: [f.model.baseUrl], daemon_version: '0.14.0' }));
  return { ...f, engineFile, unloadQuietly: () => fs.writeFileSync(engineFile, '[]') };
}

test('Foundry Local 0.14: a model that is only in the catalog is not taken for loaded; setup downloads and loads it', { skip: skipCli }, async () => {
  const f = await v014Fixture();
  try {
    await assert.rejects(f.llm.prepare(), (err) => err.code === 'MODEL_NOT_DOWNLOADED');
    assert.equal(f.llm.status().state, 'needs-model');
    const ready = await f.llm.prepare({ allowDownload: true });
    assert.equal(ready.modelId, NPU_ID);
    assert.ok(f.calls().includes('model download phi-4-mini'), f.calls().join(' | '));
    assert.deepEqual(JSON.parse(fs.readFileSync(f.engineFile, 'utf8')), [NPU_ID]);
    assert.equal(await f.llm.chat({ messages: [{ role: 'user', content: 'hi' }] }), 'Hello from the NPU.');
    assert.equal(f.model.state.requests.length, 1);
  } finally { await f.done(); }
});

test('Foundry Local 0.14: found through its discovery file, loaded through /models/load, reloaded after an idle unload', { skip: skipCli }, async () => {
  const f = await v014Fixture({ cached: [NPU_ID] });
  try {
    const ready = await f.llm.prepare();
    assert.equal(ready.modelId, NPU_ID);
    assert.equal(ready.device, 'NPU');
    assert.deepEqual(f.calls(), [], 'no command-line calls were needed');
    assert.ok(f.model.state.loadRequests[0].startsWith('/models/load/'));
    f.unloadQuietly();
    assert.equal(await f.llm.chat({ messages: [{ role: 'user', content: 'hi' }] }), 'Hello from the NPU.');
    assert.equal(f.model.state.requests.length, 2, 'one refused request, then the answer');
    // A later start with no internet: the remembered exact id is enough.
    f.unloadQuietly(); f.llm.invalidate();
    assert.equal((await f.llm.prepare()).modelId, NPU_ID);
  } finally { await f.done(); }
});

test('Foundry Local 0.14: without the discovery file the command line still finds the service', { skip: skipCli }, async () => {
  const f = await v014Fixture({ cached: [NPU_ID], daemonFile: false });
  try {
    assert.equal((await f.llm.prepare()).modelId, NPU_ID);
    assert.ok(f.calls().some((c) => / status$/.test(c)), f.calls().join(' | '));
  } finally { await f.done(); }
});

test('Foundry Local 0.14 with no catalogue file: builds come from /v1/models once the service is running', { skip: skipCli }, async () => {
  const f = await v014Fixture({ cached: [NPU_ID] });
  try {
    assert.deepEqual(await f.llm.listFoundryModels(), [], 'nothing is started just to fill a list');
    await f.llm.prepare();
    const families = await f.llm.listFoundryModels();
    assert.deepEqual(families.map((x) => [x.alias, x.builds.map((b) => b.id)]), [
      ['phi-4', ['Phi-4-generic-gpu:2']],
      ['phi-4-mini-instruct', [NPU_ID, 'phi-4-mini-instruct-generic-cpu:5']],
    ]);
    assert.deepEqual(families[1].devices, ['NPU', 'CPU']);
  } finally { await f.done(); }
});

// Choosing hardware by measurement. On a real install Foundry Local's own default was the NPU build,
// which wrote about 2 tokens a second; which build is quickest has to be timed on each machine.
const GPU_ID = 'Phi-4-mini-instruct-generic-gpu:5';
const CPU_ID = 'Phi-4-mini-instruct-generic-cpu:5';
async function catalogFixture() {
  const f = await v014Fixture({ cached: [NPU_ID] });
  const models = path.join(f.dir, 'cache', 'models');
  const row = (id, alias, device, ep, mb, task = 'chat-completion') => ({ id, name: id.split(':')[0], version: Number(id.split(':')[1]), alias, task, fileSizeMb: mb, publisher: 'Microsoft', runtime: { deviceType: device, executionProvider: ep } });
  fs.mkdirSync(path.join(models, 'Microsoft', 'phi-4-mini-instruct-vitis-npu-2', 'v2'), { recursive: true });
  fs.writeFileSync(path.join(models, 'Microsoft', 'phi-4-mini-instruct-vitis-npu-2', 'v2', 'inference_model.json'), '{}');
  fs.mkdirSync(path.join(models, 'Microsoft', 'Phi-4-mini-instruct-generic-gpu-5', 'v5'), { recursive: true }); // a download that never finished
  fs.writeFileSync(path.join(models, 'foundry.modelinfo.json'), JSON.stringify({ version: 1, models: [
    row(CPU_ID, 'phi-4-mini', 'CPU', 'CPUExecutionProvider', 4915),
    row(GPU_ID, 'phi-4-mini', 'GPU', 'WebGPUExecutionProvider', 3809),
    row(NPU_ID, 'phi-4-mini', 'NPU', 'VitisAIExecutionProvider', 3686),
    row('qwen2.5-1.5b-instruct-generic-gpu:4', 'qwen2.5-1.5b', 'GPU', 'WebGPUExecutionProvider', 1546),
    row('openai-whisper-base-generic-cpu:3', 'whisper-base', 'CPU', 'CPUExecutionProvider', 150, 'automatic-speech-recognition'),
  ] }));
  const cli = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  fs.writeFileSync(f.stateFile, JSON.stringify({ ...cli, catalog: { 'phi-4-mini': NPU_ID, gpu: GPU_ID, cpu: CPU_ID } }));
  f.model.state.delays = { [NPU_ID]: 60, [GPU_ID]: 8 };
  return f;
}

test('the model list comes from Foundry Local\'s own catalogue: families, builds, sizes, and what is already downloaded', { skip: skipCli }, async () => {
  const f = await catalogFixture();
  try {
    const families = await f.llm.listFoundryModels();
    assert.deepEqual(families.map((x) => x.alias), ['qwen2.5-1.5b', 'phi-4-mini'], 'chat models only, smallest first');
    const phi = families[1];
    assert.deepEqual(phi.builds.map((b) => [b.id, b.device, b.sizeMb, b.cached]), [[NPU_ID, 'NPU', 3686, true], [GPU_ID, 'GPU', 3809, false], [CPU_ID, 'CPU', 4915, false]]);
    assert.deepEqual(f.calls(), [], 'reading the list starts nothing');
  } finally { await f.done(); }
});

test('each build is timed on the same question and the fastest is found; a tested build is taken out of memory again', { skip: skipCli }, async () => {
  const f = await catalogFixture();
  try {
    await assert.rejects(f.llm.speedTest({ id: GPU_ID }), (err) => err.code === 'MODEL_NOT_DOWNLOADED');
    const statuses = [];
    const gpu = await f.llm.speedTest({ id: GPU_ID, allowDownload: true, onStatus: (s) => statuses.push(s) });
    const npu = await f.llm.speedTest({ id: NPU_ID });
    assert.ok(f.calls().includes(`model download ${GPU_ID}`), f.calls().join(' | '));
    assert.ok(statuses.some((s) => s.startsWith('Downloading')) && statuses.some((s) => s.startsWith('Timing')));
    assert.ok(gpu.tokensPerS > npu.tokensPerS * 2, `gpu ${gpu.tokensPerS} vs npu ${npu.tokensPerS}`);
    assert.ok(npu.tokensPerS > 8 && npu.tokensPerS < 25, `about 16 a second at 60 ms a word: ${npu.tokensPerS}`);
    assert.equal(gpu.device, 'GPU');
    assert.ok(gpu.loadS >= 0 && gpu.firstS >= 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.engineFile, 'utf8')), [], 'neither was left in memory');
    assert.equal(fastest([npu, gpu, { id: CPU_ID, error: 'x' }]).id, GPU_ID);
    assert.equal(fastest([{ id: 'a', error: 'x' }]), null);
    // The timed prompt is the size Ask really sends.
    const sent = f.model.state.requests.at(-1).messages[1].content;
    assert.ok(sent.length > 3000 && sent.length < 3200 && /\[2\] Lighthouse/.test(sent));
    // A build already in use stays loaded.
    await f.llm.prepare();
    await f.llm.speedTest({ id: NPU_ID });
    assert.deepEqual(JSON.parse(fs.readFileSync(f.engineFile, 'utf8')), [NPU_ID]);
  } finally { await f.done(); }
});

test('a download made only for testing can be deleted: only that build\'s folder goes, and it is unloaded first', { skip: skipCli }, async () => {
  const f = await catalogFixture();
  const models = path.join(f.dir, 'cache', 'models');
  const gpuDir = path.join(models, 'Microsoft', 'Phi-4-mini-instruct-generic-gpu-5');
  fs.writeFileSync(path.join(gpuDir, 'v5', 'inference_model.json'), '{}');
  fs.writeFileSync(path.join(gpuDir, 'v5', 'model.data'), 'x'.repeat(1000));
  try {
    assert.equal((await f.llm.listFoundryModels())[1].builds[1].cached, true);
    await f.llm.prepare();
    fs.writeFileSync(f.engineFile, JSON.stringify([NPU_ID, GPU_ID]));
    const r = await f.llm.removeDownload(GPU_ID);
    assert.deepEqual([r.removed, r.sizeMb], [true, 3809]);
    assert.ok(!fs.existsSync(gpuDir));
    assert.ok(fs.existsSync(path.join(models, 'Microsoft', 'phi-4-mini-instruct-vitis-npu-2', 'v2', 'inference_model.json')), 'the other build is untouched');
    assert.ok(fs.existsSync(path.join(models, 'foundry.modelinfo.json')));
    assert.deepEqual(JSON.parse(fs.readFileSync(f.engineFile, 'utf8')), [NPU_ID], 'taken out of memory before its files went');
    assert.equal((await f.llm.listFoundryModels())[1].builds[1].cached, false);
    assert.equal((await f.llm.removeDownload(GPU_ID)).removed, false, 'nothing left to remove');
    assert.equal((await f.llm.removeDownload('../../outside')).removed, false, 'only builds Foundry Local lists');
    // A speed test says whether it had to download the build.
    const cli = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
    assert.ok(!cli.cached.includes(GPU_ID));
    assert.equal((await f.llm.speedTest({ id: GPU_ID, allowDownload: true })).downloaded, true);
    assert.equal((await f.llm.speedTest({ id: NPU_ID })).downloaded, false);
  } finally { await f.done(); }
});

test('an exact build can be chosen instead of a family name', { skip: skipCli }, async () => {
  const f = await catalogFixture();
  try {
    f.settings.foundryModel = GPU_ID;
    const ready = await f.llm.prepare({ allowDownload: true });
    assert.equal(ready.modelId, GPU_ID);
    assert.equal(ready.device, 'GPU');
    assert.equal(await f.llm.chat({ messages: [{ role: 'user', content: 'hi' }] }), 'Hello from the NPU.');
  } finally { await f.done(); }
});

// Seen on a real install: after the app was closed, Foundry Local's service kept running with
// models in memory, holding more than half the machine's RAM.
test('memory is given back: our models are unloaded, another program\'s model is left alone, and the service is stopped only when empty', { skip: skipCli }, async () => {
  const f = await v014Fixture({ cached: [NPU_ID] });
  const { spawn } = require('node:child_process');
  const standIn = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']); // plays the part of the service's process
  const exited = new Promise((resolve) => standIn.once('exit', resolve));
  f.model.state.pid = standIn.pid;
  const engine = () => JSON.parse(fs.readFileSync(f.engineFile, 'utf8'));
  try {
    await f.llm.prepare();
    fs.writeFileSync(f.engineFile, JSON.stringify([NPU_ID, 'someone-elses-model:1']));
    let r = await f.llm.releaseMemory({ stopService: true });
    assert.deepEqual([r.unloaded, r.left, r.stopped], [[NPU_ID], ['someone-elses-model:1'], false]);
    assert.ok(!f.calls().some((c) => / stop$/.test(c)), 'the service is in use by something else: left running');
    assert.notEqual(f.llm.status().state, 'ready');
    assert.equal(standIn.exitCode, null);

    // One model kept (after a speed test): everything else of ours goes, the service stays.
    await f.llm.prepare();
    fs.writeFileSync(f.engineFile, JSON.stringify([NPU_ID, 'Phi-4-mini-instruct-generic-gpu:5']));
    r = await f.llm.releaseMemory({ keep: NPU_ID, also: ['phi-4-mini-instruct-generic-gpu:5'], stopService: true });
    assert.deepEqual([r.unloaded, engine()], [['Phi-4-mini-instruct-generic-gpu:5'], [NPU_ID]]);
    assert.equal(f.llm.status().state, 'ready');

    // A model left loaded by an earlier run of the app, found on a fresh start; nothing else in the service.
    const fresh = new LlmService({ getSettings: () => f.settings, saveSettings: () => {} });
    r = await fresh.releaseMemory({ stopService: true, also: [NPU_ID] });
    assert.deepEqual([r.unloaded, engine()], [[NPU_ID], []]);
    assert.ok(f.calls().some((c) => / stop$/.test(c)), f.calls().join(' | '));
    await exited; // the stop command did not end it, so the process the service named was ended
  } finally { standIn.kill(); await f.done(); }
});

test('nothing is started in order to release memory', { skip: skipCli }, async () => {
  const f = await foundryFixture('service', { running: false });
  try {
    const r = await f.llm.releaseMemory({});
    assert.deepEqual([r.unloaded, r.stopped], [[], false]);
    assert.deepEqual(f.calls(), []);
  } finally { await f.done(); }
});

test('reports "not installed" when the Foundry CLI is absent', async () => {
  process.env.WIKIVAULT_FOUNDRY_CLI = path.join(__dirname, 'definitely-not-here');
  try {
    const llm = new LlmService({ getSettings: () => ({ provider: 'foundry' }) });
    await assert.rejects(llm.prepare(), (e) => e.code === 'NOT_INSTALLED');
    assert.equal(llm.status().state, 'not-installed');
    assert.match(llm.status().message, /not installed/);
  } finally { delete process.env.WIKIVAULT_FOUNDRY_CLI; }
});

test('any OpenAI-compatible local server works, streamed or not', async () => {
  const model = await startModelServer({ loaded: ['llama3.2'], reply: () => 'A local answer.' });
  try {
    const llm = new LlmService({ getSettings: () => ({ provider: 'custom', baseUrl: `${model.baseUrl}/v1/`, model: '' }) });
    assert.equal(await llm.chat({ messages: [{ role: 'user', content: 'q' }] }), 'A local answer.');
    assert.equal(model.state.requests[0].model, 'llama3.2', 'first listed model is used when none is named');
    const bad = new LlmService({ getSettings: () => ({ provider: 'custom', baseUrl: 'localhost' }) });
    await assert.rejects(bad.prepare(), /Enter the address/);
  } finally { await model.close(); }
});

test('a request can be cancelled', async () => {
  const model = await startModelServer({ loaded: ['m'], reply: () => 'word '.repeat(50) });
  try {
    const llm = new LlmService({ getSettings: () => ({ provider: 'custom', baseUrl: `${model.baseUrl}/v1`, model: 'm' }) });
    const ac = new AbortController();
    ac.abort('cancelled');
    await assert.rejects(llm.chat({ messages: [{ role: 'user', content: 'q' }], signal: ac.signal }), { name: 'AbortError' });
  } finally { await model.close(); }
});

test('model id matching and device detection', () => {
  const ids = ['Phi-4-mini-instruct-vitis-npu:2', 'qwen2.5-0.5b-instruct-generic-cpu:4'];
  assert.equal(matchModel(ids, 'phi-4-mini'), ids[0]);
  assert.equal(matchModel(ids, 'qwen2.5-0.5b'), ids[1]);
  assert.equal(matchModel(ids, 'mistral'), null);
  assert.equal(deviceFromModelId(ids[0]), 'NPU');
  assert.equal(deviceFromModelId(ids[1]), 'CPU');
  assert.equal(deviceFromModelId('Phi-3.5-mini-instruct-openvino-gpu:1'), 'GPU');
  assert.equal(deviceFromModelId('phi-4-mini-instruct-qnn-npu:1'), 'NPU');
});
