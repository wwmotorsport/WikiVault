'use strict';
// Small HTTP helpers on top of Node's http/https. No Electron dependency so
// the same code runs in the app and under `node --test`.

const http = require('node:http');
const https = require('node:https');

const USER_AGENT = 'Wikivault/0.1 (offline Wikipedia reader)';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

class HttpError extends Error {
  constructor(status, url, body = '') {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function abortError(signal) {
  const err = new Error(typeof signal?.reason === 'string' ? signal.reason : 'aborted');
  err.name = 'AbortError';
  err.reason = signal?.reason;
  return err;
}

/**
 * Open a request and resolve with the response stream once headers arrive.
 * Follows redirects. The caller must consume or destroy `res`.
 */
function open(url, opts = {}) {
  const {
    method = 'GET', headers = {}, body, signal,
    timeoutMs = 30000, maxRedirects = 8,
  } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    let target;
    try { target = new URL(url); } catch (e) { return reject(new Error(`Bad URL: ${url}`)); }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(target, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers },
    });

    const onAbort = () => req.destroy(abortError(signal));
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${target.host}`)));
    req.on('error', (err) => { cleanup(); reject(err); });
    req.on('response', (res) => {
      if (REDIRECTS.has(res.statusCode) && res.headers.location) {
        res.resume();
        cleanup();
        if (maxRedirects <= 0) return reject(new Error(`Too many redirects for ${url}`));
        const next = new URL(res.headers.location, target).toString();
        const nextMethod = res.statusCode === 303 ? 'GET' : method;
        return resolve(open(next, { ...opts, method: nextMethod, maxRedirects: maxRedirects - 1 }));
      }
      // Keep the abort hook alive for the body: destroying the request tears the response down too.
      res.once('close', cleanup);
      resolve({ res, url: target.toString(), req });
    });
    if (body != null) req.write(body);
    req.end();
  });
}

function readBody(res, maxBytes = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { res.destroy(new Error('Response too large')); return; }
      chunks.push(c);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
    res.on('aborted', () => reject(new Error('Connection closed early')));
  });
}

/** GET (or other) and return the body as text. Throws HttpError on status >= 400 unless allowError. */
async function fetchText(url, opts = {}) {
  const { res, url: finalUrl } = await open(url, opts);
  const buf = await readBody(res, opts.maxBytes);
  const text = buf.toString('utf8');
  if (res.statusCode >= 400 && !opts.allowError) throw new HttpError(res.statusCode, finalUrl, text.slice(0, 2000));
  return { status: res.statusCode, headers: res.headers, text, url: finalUrl };
}

async function fetchJson(url, opts = {}) {
  const out = await fetchText(url, opts);
  try { return { ...out, json: JSON.parse(out.text) }; } catch (e) {
    throw new Error(`Expected JSON from ${out.url}`);
  }
}

/** HEAD request; returns status, headers and the final URL after redirects. */
async function head(url, opts = {}) {
  const { res, url: finalUrl } = await open(url, { ...opts, method: 'HEAD' });
  res.resume();
  return { status: res.statusCode, headers: res.headers, url: finalUrl };
}

module.exports = { open, readBody, fetchText, fetchJson, head, HttpError, abortError, USER_AGENT };
