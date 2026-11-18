'use strict';
// Contacts from an account, read over the network: Google (sign-in in the browser, then Google's People
// service) and Apple iCloud (CardDAV, with an app-specific password). Read only: nothing is ever written
// back to either account. Both give contacts in the shape vcard.js gives. No Electron.

const http = require('node:http');
const crypto = require('node:crypto');
const { fetchLike } = require('./httpx');
const vcard = require('./vcard');

const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  people: 'https://people.googleapis.com/v1/people/me/connections',
  scope: 'https://www.googleapis.com/auth/contacts.readonly',
};
const ICLOUD = 'https://contacts.icloud.com/';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** An error the app answers by asking the user to sign in again. */
const again = (message) => Object.assign(new Error(message), { code: 'SIGN_IN_AGAIN' });

async function postForm(fetchImpl, url, fields, signal) {
  const res = await fetchImpl(url, { method: 'POST', signal, timeoutMs: 30000, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(fields).toString() });
  let j = null;
  try { j = JSON.parse(await res.text()); } catch { j = null; }
  if (res.ok && j && !j.error) return j;
  const code = j && j.error;
  if (code === 'invalid_grant') throw again('Google no longer accepts the saved sign-in. Sign in again.');
  if (code === 'invalid_client' || code === 'unauthorized_client') throw new Error('Google did not accept the client ID and secret. Check that both were copied whole, from a client of the type "Desktop app".');
  throw new Error(`Google answered ${res.status}${j && (j.error_description || j.error) ? `: ${j.error_description || j.error}` : ''}.`);
}

const PAGE = (title, text) => `<!doctype html><meta charset="utf-8"><title>Wikivault</title><body style="font:16px system-ui;max-width:32em;margin:15vh auto;padding:0 1em"><h1 style="font-size:1.3em">${title}</h1><p>${text}</p></body>`;

/**
 * Sign in to Google in the user's own browser and come back with a lasting sign-in.
 * `open(url)` opens the browser. The browser returns to a port on this computer that only this call listens on.
 * Returns { refreshToken }.
 */
async function googleSignIn({ clientId, clientSecret, open, endpoints = GOOGLE, fetchImpl = fetchLike, signal = null, waitMs = 300000 }) {
  if (!clientId || !clientSecret) throw new Error('Enter the client ID and the client secret first.');
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirect = `http://127.0.0.1:${server.address().port}`;
  try {
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The sign-in was not finished in the browser in time. Try again.')), waitMs);
      const stop = () => { clearTimeout(timer); reject(new Error('Stopped.')); };
      if (signal) signal.addEventListener('abort', stop, { once: true });
      server.on('request', (req, res) => {
        const u = new URL(req.url, redirect);
        if (u.pathname !== '/' || (!u.searchParams.has('code') && !u.searchParams.has('error'))) { res.writeHead(404).end(); return; }
        const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(ok ? PAGE('Signed in', 'Wikivault has what it needs. You can close this tab and go back to the app.') : PAGE('Not signed in', 'The sign-in did not finish. Go back to Wikivault and try again.'));
        clearTimeout(timer);
        if (ok) resolve(ok); else reject(new Error(u.searchParams.get('error') === 'access_denied' ? 'The sign-in was cancelled in the browser.' : 'The sign-in did not finish.'));
      });
      const url = `${endpoints.auth}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: endpoints.scope, code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' })}`;
      Promise.resolve(open(url)).catch(reject);
    });
    const tok = await postForm(fetchImpl, endpoints.token, { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }, signal);
    if (!tok.refresh_token) throw new Error('Google signed in but gave no lasting sign-in. Remove Wikivault under "Third-party apps" in your Google account, then sign in again.');
    return { refreshToken: tok.refresh_token };
  } finally { server.close(); if (server.closeAllConnections) server.closeAllConnections(); }
}

const typeOf = (x) => String((x && (x.formattedType || x.type)) || '').toLowerCase();

/** Read every contact of the signed-in Google account. */
async function googleContacts({ clientId, clientSecret, refreshToken, endpoints = GOOGLE, fetchImpl = fetchLike, signal = null }) {
  const tok = await postForm(fetchImpl, endpoints.token, { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }, signal);
  const out = []; let pageToken = '';
  for (let page = 0; page < 200; page++) {
    const q = new URLSearchParams({ personFields: 'names,addresses,phoneNumbers,emailAddresses,organizations,biographies', pageSize: '1000', sortOrder: 'LAST_NAME_ASCENDING', ...(pageToken ? { pageToken } : {}) });
    const res = await fetchImpl(`${endpoints.people}?${q}`, { signal, timeoutMs: 60000, headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/json' } });
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch { j = null; }
    if (!res.ok || !j) {
      const msg = j && j.error && j.error.message ? j.error.message : '';
      if (res.status === 401) throw again('Google no longer accepts the saved sign-in. Sign in again.');
      if (res.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(text)) throw new Error('The People API is not switched on for your Google Cloud project. Switch it on there (APIs and services, Library, People API), wait a minute, and try again.');
      throw new Error(`Google answered ${res.status}${msg ? `: ${msg}` : ''}.`);
    }
    for (const p of j.connections || []) {
      const c = { uid: p.resourceName || '', name: ((p.names || [])[0] || {}).displayName || '', org: ((p.organizations || [])[0] || {}).name || '', note: String(((p.biographies || [])[0] || {}).value || '').slice(0, 2000), addresses: [], phones: [], emails: [] };
      for (const a of p.addresses || []) { const t = String(a.formattedValue || [a.streetAddress, [a.city, [a.region, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', '), a.country].filter(Boolean).join('\n')).trim(); if (t) c.addresses.push({ label: typeOf(a), text: t }); }
      for (const t of p.phoneNumbers || []) if (t.value) c.phones.push({ label: typeOf(t), value: String(t.value) });
      for (const e of p.emailAddresses || []) if (e.value) c.emails.push(String(e.value));
      if (!c.name) c.name = c.org || c.emails[0] || '';
      if (c.name || c.addresses.length || c.phones.length) out.push(c);
    }
    pageToken = j.nextPageToken || '';
    if (!pageToken) break;
  }
  return out;
}

// ---- CardDAV, as iCloud speaks it

const unxml = (s) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The contents of the first element of this name, whatever prefix its namespace was given. */
const inner = (text, name) => { const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(text); return m ? m[1] : null; };
const responsesOf = (text) => [...text.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/g)].map((m) => m[1]);
const hrefOf = (text) => { const h = inner(text || '', 'href'); return h == null ? null : unxml(h).trim(); };

async function dav(fetchImpl, url, { method, depth, body, auth, signal, denied }) {
  const res = await fetchImpl(url, { method, signal, timeoutMs: 60000, headers: { authorization: auth, depth: String(depth), 'content-type': 'application/xml; charset=utf-8', accept: 'application/xml, text/xml' }, body });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw again(denied);
  if (res.status !== 207) throw new Error(`The contacts server answered ${res.status}.`);
  return { text, url: res.url || url };
}

const APPLE_DENIED = 'Apple did not accept the Apple ID and the app-specific password. An app-specific password is made at account.apple.com, under Sign-In and Security; your usual password will not work here.';
const GOOGLE_DENIED = 'Google did not accept the address and the app password. An app password is made at myaccount.google.com/apppasswords and needs 2-Step Verification to be on; your usual password will not work here. If the app password is right, Google may not allow this way in for your account: use the sign-in through a client instead.';

/**
 * Read every contact of a CardDAV account. `base` is where the server is asked whose account this is and where
 * its address books are (iCloud's way in). `book`, when given, is one address book's own address, read directly.
 */
async function carddavContacts({ user, password, base = ICLOUD, book = null, denied = APPLE_DENIED, fetchImpl = fetchLike, signal = null }) {
  if (!user || !password) throw new Error('Enter the account and an app password first.');
  const auth = `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
  const ask = (url, method, depth, body) => dav(fetchImpl, url, { method, depth, body, auth, signal, denied });
  const prop = (p) => `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop>${p}</d:prop></d:propfind>`;

  let books = book ? [book] : null;
  if (!books) {
  const a = await ask(base, 'PROPFIND', 0, prop('<d:current-user-principal/>'));
  const principal = hrefOf(inner(a.text, 'current-user-principal'));
  if (!principal) throw new Error('The contacts server did not say whose account this is.');
  const b = await ask(new URL(principal, a.url).toString(), 'PROPFIND', 0, prop('<card:addressbook-home-set/>'));
  const home = hrefOf(inner(b.text, 'addressbook-home-set'));
  if (!home) throw new Error('The account has no address books.');
  const c = await ask(new URL(home, b.url).toString(), 'PROPFIND', 1, prop('<d:resourcetype/><d:displayname/>'));
  books = responsesOf(c.text).filter((r) => /<(?:[\w-]+:)?addressbook\b/.test(inner(r, 'resourcetype') || '')).map((r) => new URL(hrefOf(r), c.url).toString());
  }
  const out = [];
  for (const one of books) {
    const list = await ask(one, 'PROPFIND', 1, prop('<d:getetag/><d:resourcetype/>'));
    const bookPath = new URL(one).pathname.replace(/\/+$/, '');
    const hrefs = responsesOf(list.text).filter((r) => !/<(?:[\w-]+:)?collection\b/.test(inner(r, 'resourcetype') || '')).map(hrefOf).filter((h) => h && new URL(h, one).pathname.replace(/\/+$/, '') !== bookPath);
    for (let i = 0; i < hrefs.length; i += 50) {
      const body = `<?xml version="1.0" encoding="utf-8"?><card:addressbook-multiget xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop>${hrefs.slice(i, i + 50).map((h) => `<d:href>${xml(h)}</d:href>`).join('')}</card:addressbook-multiget>`;
      const got = await ask(one, 'REPORT', 1, body);
      for (const r of responsesOf(got.text)) { const data = inner(r, 'address-data'); if (data) for (const card of vcard.parse(unxml(data))) out.push(card); }
    }
  }
  return out;
}

const icloudContacts = (o) => carddavContacts({ ...o, denied: APPLE_DENIED });
/** Google's contacts by app password: its CardDAV server, at the account's one address book. Google documents this server as needing the full sign-in, but it has gone on accepting app passwords. */
const GOOGLE_BOOK = (user) => `https://www.googleapis.com/carddav/v1/principals/${encodeURIComponent(user)}/lists/default/`;
const googleByPassword = ({ user, password, book = null, ...rest }) => carddavContacts({ ...rest, user, password, book: book || GOOGLE_BOOK(user), denied: GOOGLE_DENIED });

module.exports = { googleSignIn, googleContacts, googleByPassword, icloudContacts, carddavContacts, GOOGLE, GOOGLE_BOOK, ICLOUD };
