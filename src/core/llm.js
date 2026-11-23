'use strict';
// Local model access. Two ways in:
//   - "foundry": Microsoft Foundry Local, which picks the NPU/GPU/CPU build of
//     a model for this machine. We drive it through its CLI (start the local
//     service, load the model) and talk to its OpenAI-compatible endpoint.
//   - "custom": any OpenAI-compatible server on this machine (Ollama, LM Studio,
//     AMD Lemonade Server, llama.cpp).
// Nothing here talks to a cloud service.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { open, readBody, fetchText, abortError } = require('./httpx');

const LOCAL_URL = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/i;
const SAFE_ARG = /^[\w.:\-/]+$/;
// Foundry Local unloads an idle model after its time-to-live (10 minutes unless told otherwise).
// Ask for an hour, and reload on demand when a question arrives after that.
const MODEL_TTL_SECONDS = 3600;
const NOT_LOADED = /not loaded|must be loaded|isn't loaded|is not loaded|load (it|the model) (first|before)/i;

function deviceFromModelId(id) {
  if (/npu|vitis|qnn/i.test(id)) return 'NPU';
  if (/gpu|cuda|webgpu|trt|migraphx/i.test(id)) return 'GPU';
  if (/cpu/i.test(id)) return 'CPU';
  return '';
}

function matchModel(ids, wanted) {
  if (!wanted) return null;
  const w = wanted.toLowerCase();
  return ids.find((id) => id.toLowerCase() === w)
    || ids.find((id) => id.toLowerCase().startsWith(w))
    || ids.find((id) => id.toLowerCase().includes(w))
    || null;
}

/** Run the Foundry CLI and collect its output. Resolves even on non-zero exit. */
const lastLines = (out) => String(out || '').trim().split(/\r?\n/).slice(-2).join(' ');
/** The versions winget lists for a package ("winget show --versions"), newest first as it prints them. */
function wingetVersions(out) {
  const lines = String(out || '').split(/\r?\n/).map((s) => s.trim());
  const rule = lines.findIndex((s) => /^-{3,}$/.test(s));
  return lines.slice(rule + 1).filter((s) => /^\d+(?:\.\d+){1,3}$/.test(s));
}

function runCli(args, { onOutput = () => {}, timeoutMs = 60000, signal, command = process.env.WIKIVAULT_FOUNDRY_CLI || 'foundry' } = {}) {
  return new Promise((resolve) => {
    for (const a of args) {
      if (!SAFE_ARG.test(a)) return resolve({ code: -1, out: `Refusing unsafe argument: ${a}`, missing: false });
    }
    let out = '';
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    let child;
    try {
      // On Windows the CLI may be an app-execution alias or a .cmd shim, which need the shell.
      child = spawn(command, args, { windowsHide: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return finish({ code: -1, out: err.message, missing: err.code === 'ENOENT' });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ code: -1, out: `${out}\n(timed out)`, timedOut: true }); }, timeoutMs);
    signal?.addEventListener('abort', () => { try { child.kill(); } catch { /* gone */ } }, { once: true });
    const onData = (d) => {
      const s = d.toString();
      out += s;
      const lines = s.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
      if (lines.length) onOutput(lines[lines.length - 1]);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => finish({ code: -1, out: err.message, missing: err.code === 'ENOENT' }));
    child.on('close', (code) => {
      // With shell:true on Windows a missing program is reported by cmd.exe rather than as ENOENT.
      const missing = process.platform === 'win32' && code !== 0
        && /is not recognized as an internal or external command/i.test(out);
      finish({ code, out, missing });
    });
  });
}

/**
 * A program installed while the app is running may add itself to PATH, which this process
 * read once at start. Re-read the machine and user PATH from the registry so a new `foundry`
 * command is found without restarting.
 */
function refreshWindowsPath() {
  if (process.platform !== 'win32') return Promise.resolve();
  const read = (key) => new Promise((resolve) => {
    execFile('reg.exe', ['query', key, '/v', 'Path'], { windowsHide: true }, (err, out) => {
      const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(String(out || ''));
      resolve(m ? m[1].trim() : '');
    });
  });
  const expand = (s) => s.replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all);
  return Promise.all([
    read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    read('HKCU\\Environment'),
  ]).then(([machine, user]) => {
    const current = (process.env.PATH || process.env.Path || '').split(';');
    const merged = [...new Set([...current, ...expand(machine).split(';'), ...expand(user).split(';')].map((p) => p.trim()).filter(Boolean))];
    process.env.PATH = merged.join(';');
  }).catch(() => {});
}

// A fixed, self-written passage for speed tests, so every build is timed on the same work.
const SPEED_TEST_PASSAGE = 'A lighthouse is a tower built to send out light as an aid to ships. Early lighthouses burned wood or coal on an open platform, which gave an unsteady light and used a great deal of fuel. Oil lamps with reflectors replaced open fires, and later a lens made of stepped glass rings gathered far more of the lamp\'s light into a single beam that could be seen from many kilometres away. Each lighthouse shows its own pattern of flashes so that a navigator can tell one from another at night. ';
function speedTestMessages(contextChars) {
  let passages = '';
  for (let i = 1; passages.length < contextChars; i += 1) passages += `[${i}] Lighthouse, section ${i}\n${SPEED_TEST_PASSAGE}\n\n`;
  return [
    { role: 'system', content: 'You answer questions using only the numbered passages. Cite passages like [1]. Be concise.' },
    { role: 'user', content: `Passages:\n${passages.slice(0, contextChars)}\nQuestion: How did lighthouses come to throw their light further?` },
  ];
}

/** The quickest writer among successful speed tests; the earlier first word breaks a tie. */
function fastest(results) {
  return (results || []).filter((r) => r && !r.error && r.tokensPerS > 0)
    .sort((x, y) => y.tokensPerS - x.tokensPerS || x.firstS - y.firstS)[0] || null;
}

class LlmService {
  /**
   * @param {object} o
   * @param {() => object} o.getSettings   returns the `ai` settings block
   * @param {(patch:object) => void} o.saveSettings  merges into the `ai` block
   */
  constructor({ getSettings, saveSettings = () => {}, log = () => {} }) {
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.log = log;
    this.cache = null;       // { baseUrl, modelId, device, provider }
    this.lastBaseUrl = null;
    this.touched = new Set(); // models this app asked Foundry Local to load, so it can take them out again
    this.cliGroup = null;    // 'server' (current CLI) or 'service' (older CLI)
    this.preparing = null;
    this.last = { state: 'unknown', message: '' };
  }

  status() {
    const s = this.getSettings();
    return {
      enabled: s.enabled !== false,
      provider: s.provider || 'foundry',
      ...this.last,
      modelId: this.cache?.modelId || null,
      device: this.cache?.device || '',
      endpoint: this.cache?.baseUrl || null,
    };
  }

  invalidate() { this.cache = null; }

  /**
   * Give memory back. Takes the models this app loaded out of Foundry Local and, when asked,
   * stops Foundry Local's background service if nothing else is loaded in it (another program
   * may be using it). Never starts the service in order to do this.
   *   keep: one model to leave loaded;  also: more ids to treat as this app's.
   */
  async releaseMemory({ stopService = false, keep = null, also = [] } = {}) {
    const result = { unloaded: [], left: [], stopped: false };
    let baseUrl = (this.cache?.provider === 'foundry' && this.cache.baseUrl) || await this._alive(this.lastBaseUrl) || await this._alive(this._daemonUrl());
    if (!baseUrl && stopService) {
      // Older versions have no discovery file; the command line knows whether the service is up.
      const st = await this._cliStatus().catch(() => ({}));
      baseUrl = st.url ? await this._alive(st.url) : null;
    }
    if (!keep) { this.cache = null; if (this.last.state === 'ready') this._setState('unknown'); }
    if (!baseUrl) return result;
    const low = (x) => String(x).toLowerCase();
    const ours = new Set([...this.touched, ...also].filter(Boolean).map(low));
    const listed = await this._loadedModels(baseUrl);
    for (const id of listed || [...this.touched]) {
      if (!ours.has(low(id)) || (keep && low(id) === low(keep))) continue;
      if (await this._unload(baseUrl, id).catch(() => false)) result.unloaded.push(id);
    }
    this.touched = new Set(keep ? [keep] : []);
    result.left = (await this._loadedModels(baseUrl)) || [];
    if (stopService && !result.left.length && !keep) {
      let pid = null;
      try { pid = Number(JSON.parse((await fetchText(`${baseUrl}/status`, { timeoutMs: 4000 })).text)?.pid) || null; } catch { /* older versions */ }
      if (!this.cliGroup) await this._cliStatus().catch(() => {});
      await runCli([this.cliGroup || 'service', 'stop'], { timeoutMs: 20000 }).catch(() => {});
      result.stopped = !(await this._alive(baseUrl));
      if (!result.stopped && pid > 4 && pid !== process.pid) {
        // The command did not stop it. The service said which process it is; end that one.
        try { process.kill(pid); } catch { /* already gone, or not ours to end */ }
        await new Promise((res) => setTimeout(res, 800));
        result.stopped = !(await this._alive(baseUrl));
      }
    }
    if (result.unloaded.length || result.stopped || result.left.length) {
      this.log(`memory: unloaded ${result.unloaded.join(', ') || 'nothing'}${result.left.length ? `; still loaded: ${result.left.join(', ')}` : ''}${result.stopped ? '; Foundry Local service stopped' : ''}`);
    }
    return result;
  }

  _setState(state, message = '') {
    this.last = { state, message };
  }

  // ---- Foundry Local -----------------------------------------------------

  async _cliStatus() {
    // The CLI's service commands were renamed from `foundry service …` to `foundry server …`.
    const groups = this.cliGroup ? [this.cliGroup] : ['server', 'service'];
    let lastOut = '';
    for (const g of groups) {
      const r = await runCli([g, 'status'], { timeoutMs: 30000 });
      if (r.missing) return { missing: true };
      lastOut = r.out;
      const url = (LOCAL_URL.exec(r.out) || [])[0] || null;
      const unknown = /unknown command|unrecognized command|not a valid command|invalid command|required command was not provided/i.test(r.out);
      if (url || !unknown) { this.cliGroup = g; return { url, out: r.out }; }
    }
    this.cliGroup = this.cliGroup || 'server';
    return { url: null, out: lastOut };
  }

  /** Returns the base URL that actually answers, or null. */
  async _alive(url) {
    if (!url) return null;
    const base = url.replace(/\/+$/, '');
    const candidates = [...new Set([base, base.replace('localhost', '127.0.0.1')])];
    for (const c of candidates) {
      for (const p of ['/status', '/openai/status', '/v1/models']) {
        try {
          const r = await fetchText(c + p, { timeoutMs: 4000, allowError: true });
          if (r.status < 300) return c;
        } catch { /* try next */ }
      }
    }
    return null;
  }

  /** The address Foundry Local 0.14's background service writes for other programs to find it. */
  _daemonUrl() {
    try {
      const home = process.env.WIKIVAULT_FOUNDRY_HOME || path.join(os.homedir(), '.foundry');
      const url = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'))?.web_urls?.[0];
      return typeof url === 'string' && LOCAL_URL.test(url) ? url : null;
    } catch { return null; }
  }

  async _foundryEndpoint(onStatus) {
    const direct = await this._alive(this._daemonUrl());
    if (direct) return direct;
    const st = await this._cliStatus();
    if (st.missing) {
      const e = new Error('Foundry Local is not installed (the "foundry" command was not found). If you installed it a moment ago, restart Wikivault.');
      e.code = 'NOT_INSTALLED';
      throw e;
    }
    let base = await this._alive(st.url);
    if (!base) {
      onStatus('Starting the local model service (the first start can take a minute)');
      const r = await runCli([this.cliGroup, 'start'], { timeoutMs: 120000 });
      let url = (LOCAL_URL.exec(r.out) || [])[0] || st.url;
      for (let i = 0; i < 90; i++) {
        base = await this._alive(url) || await this._alive(this._daemonUrl());
        if (base) break;
        await new Promise((res) => setTimeout(res, 1000));
        url = (await this._cliStatus()).url || url;
      }
    }
    if (!base) throw new Error(`Foundry Local did not report a working local address. Run "foundry ${this.cliGroup} status" in a terminal to see why.`);
    return base;
  }

  /**
   * Models in memory right now, or null when the service offers no such list.
   * Foundry Local 0.14 serves it at /models/loaded; earlier versions at /openai/loadedmodels.
   * /v1/models is deliberately not consulted: it lists the whole catalog, loaded or not.
   */
  async _loadedModels(baseUrl) {
    for (const p of ['/models/loaded', '/openai/loadedmodels']) {
      try {
        const r = await fetchText(baseUrl + p, { timeoutMs: 8000 });
        const arr = JSON.parse(r.text);
        if (Array.isArray(arr)) return arr.map((x) => (typeof x === 'string' ? x : String(x?.model_id || x?.id || x?.name || ''))).filter(Boolean);
      } catch { /* try the other spelling */ }
    }
    return null;
  }

  /**
   * Ask the service to load a model, by exact id or by family name. Returns whether it said yes
   * and, when it reports one, the exact id it loaded. Both generations of the API are tried.
   */
  async _restLoad(baseUrl, name, signal) {
    const enc = encodeURIComponent(name);
    let last = '';
    for (const p of [`/models/load/${enc}`, `/openai/load/${enc}?ttl=${MODEL_TTL_SECONDS}`]) {
      try {
        const r = await fetchText(baseUrl + p, { timeoutMs: 900000, signal, allowError: true });
        if (r.status < 300) {
          let modelId = null;
          try { modelId = JSON.parse(r.text)?.model_id || null; } catch { /* older versions answer with no body */ }
          this.touched.add(modelId || name);
          return { ok: true, modelId };
        }
        const said = `HTTP ${r.status} ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`;
        if (!last || !/No mapping for HTTP-method/i.test(said)) last = said; // a real answer beats a route that does not exist
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        last = err.message;
      }
    }
    this.log(`load ${name}: ${last}`);
    return { ok: false, modelId: null };
  }

  async _prepareFoundry(onStatus, signal, allowDownload) {
    const s = this.getSettings();
    const alias = (s.foundryModel || 'phi-4-mini').trim();
    if (!SAFE_ARG.test(alias)) throw new Error('The model name can only contain letters, numbers, dots, dashes and colons.');
    const baseUrl = await this._foundryEndpoint(onStatus);
    const remembered = s.foundryModelFor === alias ? s.foundryModelId : null;
    const loaded = async () => (await this._loadedModels(baseUrl)) || [];
    const pick = (ids) => matchModel(ids, remembered) || matchModel(ids, alias);

    const before = await loaded();
    let modelId = pick(before);
    let viaService = false;

    if (!modelId) {
      // Through the service first: by exact id it needs no catalog lookup, so it works offline.
      onStatus('Loading the model into memory');
      const r = await this._restLoad(baseUrl, remembered || alias, signal);
      if (r.ok) {
        modelId = r.modelId || pick(await loaded()) || remembered;
        viaService = Boolean(modelId);
      }
    }

    if (!modelId) {
      const cliLoad = async (name) => {
        const r = await runCli(['model', 'load', name], { timeoutMs: 900000, signal, onOutput: (l) => onStatus(`Loading the model: ${l.slice(0, 80)}`) });
        const after = await loaded();
        // With no list to consult, take the id the command line names in its own success line.
        const named = /\bsuccess\b|loaded successfully/i.test(r.out) ? (/variant '([^']+)'/i.exec(r.out) || /Model (\S+) loaded/i.exec(r.out) || [])[1] : null;
        return { r, id: pick(after) || after.find((id) => !before.includes(id)) || (named && SAFE_ARG.test(named) ? named : null) };
      };
      let attempt = await cliLoad(remembered || alias);
      modelId = attempt.id;
      if (!modelId && !allowDownload) {
        // Several gigabytes over the internet is the user's call, made from the Library page.
        const e = new Error(`The model "${alias}" has not been downloaded yet.`);
        e.code = 'MODEL_NOT_DOWNLOADED';
        throw e;
      }
      if (!modelId) {
        onStatus('Downloading the model (one time, needs internet)');
        const dl = await runCli(['model', 'download', alias], { timeoutMs: 6 * 3600e3, signal, onOutput: (l) => onStatus(`Downloading the model: ${l.slice(0, 80)}`) });
        if (signal?.aborted) throw abortError(signal);
        onStatus('Loading the model into memory');
        const r = await this._restLoad(baseUrl, alias, signal);
        if (r.ok) { modelId = r.modelId || pick(await loaded()); viaService = Boolean(modelId); }
        if (!modelId) {
          attempt = await cliLoad(alias);
          modelId = attempt.id;
        }
        if (!modelId) {
          const tail = `${dl.out}\n${attempt.r.out}`.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
          throw new Error(`Foundry Local could not load "${alias}". ${tail}`);
        }
      }
    }

    // A list can name a model that inference then refuses as "not loaded". Asking the service
    // for the load is harmless when it is loaded.
    if (!viaService) await this._restLoad(baseUrl, modelId, signal);

    this.touched.add(modelId);
    this.lastBaseUrl = baseUrl; // where the service was last seen, for releasing memory later
    this.saveSettings({ foundryModelId: modelId, foundryModelFor: alias });
    return { provider: 'foundry', baseUrl, chatUrl: `${baseUrl}/v1/chat/completions`, modelId, device: deviceFromModelId(modelId) };
  }

  /**
   * Inference said the model is not loaded. Load it for certain: through the service, and through
   * the command line if the service would not. `hard` also unloads first, to clear a stale entry.
   */
  async _forceLoad(ready, hard, signal) {
    const { baseUrl, modelId } = ready;
    if (hard) {
      for (const p of [`/models/unload/${encodeURIComponent(modelId)}`, `/openai/unload/${encodeURIComponent(modelId)}?force=true`]) {
        try {
          const r = await fetchText(baseUrl + p, { timeoutMs: 60000, signal, allowError: true });
          if (r.status < 300) break;
        } catch (err) { if (err.name === 'AbortError') throw err; }
      }
    }
    const { ok } = await this._restLoad(baseUrl, modelId, signal);
    if (ok) return;
    if (!SAFE_ARG.test(modelId)) return;
    const r = await runCli(['model', 'load', modelId], { timeoutMs: 900000, signal });
    if (r.code !== 0) this.log(`foundry model load ${modelId}: exit ${r.code}: ${r.out.trim().split(/\r?\n/).slice(-2).join(' ')}`);
  }

  // ---- which builds exist, and how fast each one is on this computer ---------------------

  _foundryHome() { return process.env.WIKIVAULT_FOUNDRY_HOME || path.join(os.homedir(), '.foundry'); }

  /** Whether Foundry Local's cache folder is where this app can see it. */
  cacheReadable() { return fs.existsSync(path.join(this._foundryHome(), 'cache', 'models', 'foundry.modelinfo.json')); }

  /** True when a build's files are fully on this computer (Foundry Local writes this file last). */
  _isCached(build) {
    try {
      const dir = path.join(this._foundryHome(), 'cache', 'models', build.publisher || 'Microsoft', build.id.replace(/:/g, '-'));
      if (fs.existsSync(path.join(dir, 'inference_model.json'))) return true;
      return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'inference_model.json')));
    } catch { return false; }
  }

  /**
   * Every chat-model build Foundry Local offers for this computer's hardware. Read from the
   * catalogue it keeps on disk, which carries sizes and devices and needs no internet; when that
   * file is absent, from whichever list the running service offers.
   */
  async _builds() {
    let rows = null;
    try {
      rows = JSON.parse(fs.readFileSync(path.join(this._foundryHome(), 'cache', 'models', 'foundry.modelinfo.json'), 'utf8'))?.models;
    } catch { /* not written yet, or an older Foundry Local */ }
    if (!Array.isArray(rows) || !rows.length) {
      // Asking the service is only worth it once it is running; opening a settings page should not start it.
      if (this.cache?.provider !== 'foundry') return [];
      const baseUrl = this.cache.baseUrl;
      const r = await fetchText(`${baseUrl}/foundry/list`, { timeoutMs: 30000, allowError: true });
      if (r.status < 400) {
        const data = JSON.parse(r.text);
        rows = Array.isArray(data) ? data : (data.models || []);
      } else {
        // Foundry Local 0.14 has no /foundry/list; its /v1/models names every exact build.
        const all = JSON.parse((await fetchText(`${baseUrl}/v1/models`, { timeoutMs: 30000 })).text)?.data || [];
        rows = all.map((m) => ({ id: String(m.id || '') }))
          .filter((m) => m.id && !/whisper|embedding|asr|speech|parakeet|-vl-/i.test(m.id));
      }
    }
    const builds = [];
    for (const m of rows) {
      const task = `${m.task || ''}`.toLowerCase();
      if (task && task !== 'chat-completion' && !task.includes('chat-comp')) continue;
      const name = String(m.name || m.displayName || '');
      const id = String(m.id || (name && m.version != null ? `${name}:${m.version}` : name));
      if (!id || !SAFE_ARG.test(id)) continue;
      const device = String(m.runtime?.deviceType || '').toUpperCase() || deviceFromModelId(`${id} ${m.runtime?.executionProvider || ''}`);
      // Without a catalogue the family is the build's name minus its hardware suffix.
      const alias = m.alias || id.replace(/[-_](generic|vitis|qnn|openvino|cuda|trt|webgpu|migraphx)[-_](cpu|gpu|npu)(:\d+)?$/i, '').toLowerCase();
      const build = { id, alias, device, sizeMb: Number(m.fileSizeMb) || null, publisher: m.publisher || 'Microsoft', reasoning: Boolean(m.supportsReasoning) };
      build.cached = this._isCached(build);
      builds.push(build);
    }
    return builds;
  }

  /** Model families Foundry Local offers for this computer, each with its builds. */
  async listFoundryModels() {
    const byAlias = new Map();
    for (const b of await this._builds()) {
      const entry = byAlias.get(b.alias) || { alias: b.alias, builds: [] };
      if (!entry.builds.some((x) => x.id === b.id)) entry.builds.push(b);
      byAlias.set(b.alias, entry);
    }
    const order = { NPU: 0, GPU: 1, CPU: 2 };
    return [...byAlias.values()].map((e) => {
      e.builds.sort((x, y) => (order[x.device] ?? 3) - (order[y.device] ?? 3));
      const sizes = e.builds.map((x) => x.sizeMb).filter(Boolean);
      return { ...e, devices: [...new Set(e.builds.map((x) => x.device).filter(Boolean))], sizeMb: sizes.length ? Math.min(...sizes) : null };
    }).sort((x, y) => (x.sizeMb || 1e9) - (y.sizeMb || 1e9) || x.alias.localeCompare(y.alias));
  }

  /**
   * Delete one build's downloaded files from Foundry Local's cache, to give the disk space back.
   * Only ever removes that build's own folder inside the cache, and unloads the build first.
   */
  async removeDownload(id) {
    const build = (await this._builds()).find((b) => b.id.toLowerCase() === String(id).toLowerCase());
    if (!build) return { removed: false, reason: 'Foundry Local does not list that build.' };
    const root = path.resolve(this._foundryHome(), 'cache', 'models');
    const dir = path.resolve(root, build.publisher || 'Microsoft', build.id.replace(/:/g, '-'));
    // The folder must sit two levels inside the cache: <cache>/<publisher>/<build>. Nothing else is touched.
    if (path.dirname(path.dirname(dir)) !== root || !fs.existsSync(dir)) return { removed: false, reason: 'Its files were not found where Foundry Local normally keeps them.' };
    const baseUrl = (this.cache?.provider === 'foundry' && this.cache.baseUrl) || await this._alive(this.lastBaseUrl) || await this._alive(this._daemonUrl());
    if (baseUrl) await this._unload(baseUrl, build.id).catch(() => {});
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
    } catch (err) {
      return { removed: false, reason: `Windows would not delete the files (${err.code || err.message}). Close anything using the model and try again.` };
    }
    const removed = !fs.existsSync(dir);
    if (removed) this.log(`removed the download of ${build.id}${build.sizeMb ? ` (${build.sizeMb} MB)` : ''}`);
    return { removed, sizeMb: build.sizeMb || 0, reason: removed ? null : 'Some files could not be deleted.' };
  }

  /** Take a build out of memory, for example the one just replaced. Best effort. */
  async unload(modelId) {
    try { return await this._unload(await this._foundryEndpoint(() => {}), modelId); } catch { return false; }
  }

  async _unload(baseUrl, modelId, signal) {
    for (const p of [`/models/unload/${encodeURIComponent(modelId)}`, `/openai/unload/${encodeURIComponent(modelId)}?force=true`]) {
      try {
        const r = await fetchText(baseUrl + p, { timeoutMs: 60000, signal, allowError: true });
        if (r.status < 300) return true;
      } catch (err) { if (err.name === 'AbortError') throw err; }
    }
    return false;
  }

  /** One timed answer of the kind Ask produces: article text in, a short cited answer out. */
  async _measure(ready, contextChars, signal) {
    const t0 = Date.now();
    let first = 0;
    let n = 0;
    await this._chatOnce(ready, {
      messages: speedTestMessages(contextChars), maxTokens: 96, temperature: 0.2, signal,
      onToken: () => { if (!first) first = Date.now(); n += 1; },
    });
    const end = Date.now();
    if (!n) throw new Error('The model returned no text.');
    const round = (x) => Math.round(x * 10) / 10;
    return { firstS: round((first - t0) / 1000), tokensPerS: n > 1 ? round((n - 1) / (Math.max(end - first, 1) / 1000)) : 0, tokens: n };
  }

  /**
   * Time one Foundry Local build on this computer: load it (downloading first if allowed), run a
   * standard question, and report how long the first word took and how fast the rest came.
   * A build that was not already in memory is taken out again afterwards.
   */
  async speedTest({ id, allowDownload = false, contextChars = 3000, keepLoaded = false, onStatus = () => {}, signal }) {
    if (!SAFE_ARG.test(String(id || ''))) throw new Error('That is not a valid model name.');
    const baseUrl = await this._foundryEndpoint(onStatus);
    const isLoaded = async () => ((await this._loadedModels(baseUrl)) || []).some((x) => x.toLowerCase() === id.toLowerCase());
    const wasLoaded = await isLoaded();
    let started = Date.now();
    let modelId = id;
    let downloaded = false;
    if (!wasLoaded) {
      onStatus(`Loading ${id}`);
      let r = await this._restLoad(baseUrl, id, signal);
      if (!r.ok) {
        if (!allowDownload) {
          const e = new Error(`${id} has not been downloaded yet.`);
          e.code = 'MODEL_NOT_DOWNLOADED';
          throw e;
        }
        onStatus(`Downloading ${id}`);
        const dl = await runCli(['model', 'download', id], { timeoutMs: 6 * 3600e3, signal, onOutput: (l) => onStatus(`Downloading ${id}: ${l.slice(0, 60)}`) });
        if (signal?.aborted) throw abortError(signal);
        downloaded = true;
        onStatus(`Loading ${id}`);
        started = Date.now();
        r = await this._restLoad(baseUrl, id, signal);
        if (!r.ok) {
          const cli = await runCli(['model', 'load', id], { timeoutMs: 900000, signal });
          if (!(await isLoaded())) {
            const tail = `${dl.out}\n${cli.out}`.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ');
            throw new Error(`Foundry Local could not load ${id}. ${tail}`);
          }
        }
      }
      if (r.modelId) modelId = r.modelId;
    }
    const loadS = wasLoaded ? null : Math.round((Date.now() - started) / 100) / 10;
    const ready = { provider: 'foundry', baseUrl, chatUrl: `${baseUrl}/v1/chat/completions`, modelId };
    try {
      onStatus(`Timing ${id}`);
      // The first request after a load pays one-off costs; time the second.
      await this._chatOnce(ready, { messages: [{ role: 'user', content: 'Reply with the word ready.' }], maxTokens: 4, temperature: 0, onToken: () => {}, signal });
      const m = await this._measure(ready, contextChars, signal);
      return { id, device: deviceFromModelId(id), ...m, loadS, contextChars, downloaded, at: new Date().toISOString() };
    } finally {
      if (!wasLoaded && !keepLoaded) await this._unload(baseUrl, modelId).catch(() => {});
    }
  }

  /** Time whatever "another model server on this laptop" points at, with the same question. */
  async speedTestCustom({ contextChars = 3000, signal } = {}) {
    const ready = await this._prepareCustom();
    const m = await this._measure(ready, contextChars, signal);
    return { id: ready.modelId, device: ready.device, ...m, loadS: null, contextChars, at: new Date().toISOString() };
  }

  /**
   * Install Foundry Local with winget (Windows). Streams installer output.
   * For a while after Microsoft publishes a new version, winget can point at an installer that is not there yet
   * ("Not found (404)") or whose checksum does not match. Then the list of packages is refreshed and it is tried
   * again, and after that the versions before it are tried, newest first.
   */
  async installFoundry(onOutput = () => {}, { run = runCli, platform = process.platform } = {}) {
    if (platform !== 'win32') throw new Error('Automatic install is only available on Windows.');
    const base = ['install', '--id', 'Microsoft.FoundryLocal', '-e', '--accept-source-agreements', '--accept-package-agreements'];
    const go = (args, timeoutMs = 30 * 60e3) => run(args, { command: 'winget', timeoutMs, onOutput });
    const ok = (r) => r.code === 0 || /already installed|No available upgrade/i.test(r.out);
    const missing = (r) => /0x80190194|\(404\)|Not found|hash does not match|Download request status is not success/i.test(r.out);
    let r = await go(base);
    if (!ok(r) && missing(r)) {
      this.log(`foundry install: the newest version could not be fetched (${lastLines(r.out)}); refreshing the package list and trying again`);
      onOutput('The newest version could not be fetched. Refreshing the list of packages and trying again.\n');
      await go(['source', 'update'], 5 * 60e3).catch(() => null);
      r = await go(base);
      if (!ok(r) && missing(r)) {
        const shown = await run(['show', '--id', 'Microsoft.FoundryLocal', '-e', '--versions', '--accept-source-agreements'], { command: 'winget', timeoutMs: 2 * 60e3 }).catch(() => null);
        for (const v of wingetVersions(shown ? shown.out : '').slice(1, 5)) {
          this.log(`foundry install: trying the earlier version ${v}`);
          onOutput(`Trying the earlier version ${v}.\n`);
          r = await go([...base, '--version', v]);
          if (ok(r) || !missing(r)) break;
        }
      }
    }
    this.cliGroup = null;
    await refreshWindowsPath();
    if (!ok(r)) {
      if (missing(r)) throw new Error('Microsoft\'s download of Foundry Local is missing just now: winget answered "Not found" for the newest version and for the ones before it. That is a fault at their end, usually put right within a day. Try again later with the button here. Everything else works meanwhile, and Ask shows the matching passages without a written answer.');
      throw new Error(`winget could not install Foundry Local. ${lastLines(r.out)}`);
    }
    return true;
  }

  // ---- any OpenAI-compatible local server --------------------------------

  async _prepareCustom() {
    const s = this.getSettings();
    const baseUrl = String(s.baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Enter the address of the local model server, for example http://localhost:11434/v1');
    let modelId = String(s.model || '').trim();
    if (!modelId) {
      const r = await fetchText(`${baseUrl}/models`, { timeoutMs: 8000 });
      modelId = JSON.parse(r.text)?.data?.[0]?.id;
      if (!modelId) throw new Error('That server did not list any models. Enter a model name.');
    }
    return { provider: 'custom', baseUrl, chatUrl: `${baseUrl}/chat/completions`, modelId, device: deviceFromModelId(modelId), apiKey: s.apiKey || '' };
  }

  // ---- shared ------------------------------------------------------------

  /** Make sure a model is loaded and ready. Safe to call repeatedly. */
  prepare({ onStatus = () => {}, signal, allowDownload = false } = {}) {
    if (this.cache) return Promise.resolve(this.cache);
    if (this.preparing) return this.preparing;
    const s = this.getSettings();
    this._setState('starting', 'Getting the local model ready');
    this.preparing = (async () => {
      try {
        const ready = (s.provider || 'foundry') === 'custom'
          ? await this._prepareCustom()
          : await this._prepareFoundry(onStatus, signal, allowDownload);
        this.cache = ready;
        this._setState('ready', '');
        return ready;
      } catch (err) {
        if (err.name === 'AbortError') { this._setState('unknown', ''); throw err; }
        const state = { NOT_INSTALLED: 'not-installed', MODEL_NOT_DOWNLOADED: 'needs-model' }[err.code] || 'error';
        this._setState(state, err.message);
        throw err;
      } finally {
        this.preparing = null;
      }
    })();
    return this.preparing;
  }

  /**
   * Chat completion with streaming. Returns the full text.
   * Reconnects once if the service restarted. If Foundry Local unloaded the model while idle,
   * loads it again (twice if need be, the second time more forcefully) and carries on.
   */
  async chat({ messages, maxTokens = 400, temperature = 0.2, onToken = () => {}, onStatus = () => {}, signal }) {
    for (let attempt = 0; ; attempt++) {
      const ready = await this.prepare({ signal, onStatus });
      try {
        return await this._chatOnce(ready, { messages, maxTokens, temperature, onToken, signal });
      } catch (err) {
        if (err.name === 'AbortError' || err.partial) throw err;
        const unloaded = ready.provider === 'foundry' && NOT_LOADED.test(err.message);
        if (attempt >= (unloaded ? 2 : 1)) {
          if (unloaded) err.message = `Foundry Local would not keep the model loaded, even after loading it again. Restarting Foundry Local usually clears this: run "foundry ${this.cliGroup || 'service'} restart" in a terminal, then ask again. (${err.message})`;
          throw err;
        }
        this.log(`chat failed (${err.message}); ${unloaded ? 'loading the model again' : 'reconnecting to the model'}`);
        if (unloaded) {
          onStatus('Loading the model into memory (it was unloaded while idle)');
          await this._forceLoad(ready, attempt >= 1, signal);
        } else {
          this.invalidate();
        }
      }
    }
  }

  async _chatOnce(ready, { messages, maxTokens, temperature, onToken, signal }) {
    const body = JSON.stringify({ model: ready.modelId, messages, stream: true, max_tokens: maxTokens, temperature });
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (ready.apiKey) headers.Authorization = `Bearer ${ready.apiKey}`;
    const { res } = await open(ready.chatUrl, { method: 'POST', headers, body, signal, timeoutMs: 300000 });

    if (res.statusCode >= 400) {
      const text = (await readBody(res)).toString('utf8');
      let msg = text.slice(0, 300);
      try { const j = JSON.parse(text); msg = j.error?.message || j.message || j.error || msg; } catch { /* plain text */ }
      throw new Error(`The local model returned an error (HTTP ${res.statusCode}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }

    if (!/event-stream/i.test(res.headers['content-type'] || '')) {
      const text = (await readBody(res)).toString('utf8');
      // Some servers ignore `stream` or send SSE with a JSON content type.
      if (/^\s*data:/m.test(text)) return this._consumeSse(text.split(/\r?\n/), onToken);
      const j = JSON.parse(text);
      const c = j.choices?.[0];
      const out = c?.message?.content ?? c?.delta?.content ?? '';
      if (out) onToken(out);
      return out;
    }

    return new Promise((resolve, reject) => {
      let buf = '';
      let full = '';
      let done = false;
      const handle = (line) => {
        const t = line.trim();
        if (!t.startsWith('data:')) return;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') { done = true; return; }
        try {
          const j = JSON.parse(payload);
          const piece = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
          if (piece) { full += piece; onToken(piece); }
        } catch { /* keep-alive or partial line */ }
      };
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(handle);
      });
      res.on('end', () => { if (buf) handle(buf); resolve(full); });
      const fail = (err) => {
        if (signal?.aborted) return reject(abortError(signal));
        if (done) return resolve(full);
        const e = new Error(err?.message || 'The connection to the local model dropped');
        if (full) e.partial = full;
        reject(e);
      };
      res.on('error', fail);
      res.on('aborted', () => fail());
    });
  }

  _consumeSse(lines, onToken) {
    let full = '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') break;
      try {
        const j = JSON.parse(payload);
        const piece = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
        if (piece) { full += piece; onToken(piece); }
      } catch { /* skip */ }
    }
    return full;
  }
}

module.exports = { LlmService, runCli, wingetVersions, matchModel, deviceFromModelId, refreshWindowsPath, fastest, speedTestMessages, LOCAL_URL };
