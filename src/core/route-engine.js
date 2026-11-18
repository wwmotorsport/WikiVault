'use strict';
// Directions: the routing engine as a helper process. BRouter's server is started on a local port
// the first time a route is asked for, answers over HTTP on this computer only, and is stopped
// when it has not been used for a while. No Electron here.

const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

class RouteEngine {
  /**
   * @param {object} o
   * @param {string} o.java        the java program to run
   * @param {string} o.jar         brouter.jar
   * @param {string} o.profiles    folder with lookups.dat and the profiles
   * @param {string} o.segments    folder with the *.rd5 files
   * @param {string} o.scratch     a folder the engine may write to
   * @param {number} [o.idleMs]    stop after this long unused
   */
  constructor({ java, jar, profiles, segments, scratch, idleMs = 10 * 60 * 1000, memoryMb = 1024, log = () => {}, fetchImpl = fetch }) {
    Object.assign(this, { java, jar, profiles, segments, scratch, idleMs, memoryMb, log, fetch: fetchImpl });
    this.child = null; this.origin = null; this.starting = null; this.timer = null; this.lastError = '';
  }

  get running() { return Boolean(this.child); }

  async start() {
    if (this.child && this.origin) return this.origin;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      for (const [what, p] of [['The routing engine', this.jar], ['The routing profiles', path.join(this.profiles, 'lookups.dat')]]) if (!fs.existsSync(p)) throw new Error(`${what} is missing from this installation (${p}). Install Wikivault again.`);
      fs.mkdirSync(this.scratch, { recursive: true });
      const port = await freePort();
      const args = [`-Xmx${this.memoryMb}M`, '-Xms64M', '-DmaxRunningTime=300', '-cp', this.jar, 'btools.server.RouteServer', this.segments, this.profiles, this.scratch, String(port), '2', '127.0.0.1'];
      let child;
      try { child = spawn(this.java, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }); } catch (err) { throw new Error(`Java could not be started (${err.message}).`); }
      let out = '';
      const keep = (d) => { out = (out + d).slice(-2000); };
      child.stdout.on('data', keep); child.stderr.on('data', keep);
      let gone = null;
      child.once('error', (err) => { gone = err.code === 'ENOENT' ? new Error('Java was not found. It comes with Wikivault; install Wikivault again.') : new Error(`Java could not be started (${err.message}).`); });
      child.once('exit', (code) => { if (!gone) gone = new Error(`The routing engine stopped (code ${code}). ${out.trim().split('\n').slice(-2).join(' ')}`.trim()); if (this.child === child) { this.child = null; this.origin = null; } this.log(`route engine exited: ${code}`); });
      const origin = `http://127.0.0.1:${port}`;
      // Ready when the port answers. An empty request is answered at once with an error page, which is enough.
      for (let i = 0; i < 100; i++) {
        if (gone) throw gone;
        const up = await new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
        if (up) { this.child = child; this.origin = origin; this.log(`route engine on ${origin}`); return origin; }
        await new Promise((r) => setTimeout(r, 150));
      }
      child.kill();
      throw new Error('The routing engine did not start in time.');
    })();
    try { return await this.starting; } finally { this.starting = null; }
  }

  /** Ask for a route. `url` is made by routing.routeUrl with this engine's origin. Returns the GeoJSON, or throws with the engine's words. */
  async ask(makeUrl, signal) {
    const origin = await this.start();
    clearTimeout(this.timer);
    try {
      const res = await this.fetch(makeUrl(origin), { signal });
      const text = await res.text();
      if (!res.ok) { const e = new Error(text.trim() || `The routing engine answered ${res.status}.`); e.engine = true; throw e; }
      try { return JSON.parse(text); } catch { const e = new Error(text.trim().slice(0, 300) || 'The routing engine sent nothing.'); e.engine = true; throw e; }
    } finally {
      if (this.idleMs > 0) { this.timer = setTimeout(() => this.stop(), this.idleMs); if (this.timer.unref) this.timer.unref(); }
    }
  }

  stop() {
    clearTimeout(this.timer);
    const c = this.child;
    this.child = null; this.origin = null;
    if (c) { try { c.kill(); } catch { /* already gone */ } }
  }
}

module.exports = { RouteEngine };
