'use strict';
// Electron main process: owns the window, the tray, the reader engine, the
// edition updater and the local model, and exposes them to the UI over IPC.
// The UI itself never touches the network.

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, session, powerSaveBlocker, powerMonitor, utilityProcess, safeStorage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

if (process.env.WIKIVAULT_USER_DATA) app.setPath('userData', process.env.WIKIVAULT_USER_DATA);

// Chromium's own background traffic (component updates, field trials and the like) has no place
// in an offline tool: the only network use is what this file does on purpose.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');
if (process.platform === 'win32') app.setAppUserModelId('local.wikivault.app');

const { EditionManager, freeBytes, copyLibrary, removeLibraryFiles } = require('../core/updater');
const { execFile } = require('node:child_process');
const { Engine, probeZim, locateEngine, installEngine } = require('../core/engine');
const os = require('node:os');
const { LlmService, refreshWindowsPath, fastest } = require('../core/llm');
const { smartSearch } = require('../core/search');
const { GolfGame, makeHole } = require('../core/golf');
const { GolfStore, CHARACTERS, COLOURS } = require('../core/golf-store');
const { sisterLink, pathCandidates } = require('../core/links');
const { tourPlan } = require('../core/tour');
const http = require('node:http');
const schoolCore = require('../core/school');
const { features } = require('../core/features');
const { SchoolLibrary } = require('../core/school-library');
const { MapsLibrary } = require('../core/maps-library');
const routing = require('../core/routing');
const { RouteEngine } = require('../core/route-engine');
const tune = require('../core/tune');
const { answerQuestion, turnSources } = require('../core/rag');
const { fetchText, open: openRequest, readBody } = require('../core/httpx');
const geocode = require('../core/geocode-online');
const catalog = require('../core/catalog');
const { AddressBook } = require('../core/address-book');
const relations = require('../core/relations');
const mapAsk = require('../core/map-ask');
const vcard = require('../core/vcard');
const contactsSync = require('../core/contacts-sync');
const { PartitionTool, SimulatedPartitionTool, sizePlan, capPlan, FALLBACK_EDITION_BYTES, GB } = require('../core/partition');

const { DEFAULT_BASE } = catalog;

const ROOT = path.join(__dirname, '..', '..');
const START_HIDDEN = process.argv.includes('--background');
// `Wikivault.exe --quit` asks a running copy to close cleanly; the uninstaller uses it.
const QUIT_REQUEST = process.argv.includes('--quit');
const LOGIN_ITEM_NAME = 'Wikivault';

// ---------------------------------------------------------------- settings

const DEFAULTS = {
  dataDir: null,
  stagingDir: null, // set when updates are downloaded on another drive before moving into the library
  partition: null,  // { driveLetter, sourceLetter, sizeBytes } when the app created a dedicated partition
  baseUrl: process.env.WIKIVAULT_BASE_URL || DEFAULT_BASE,
  language: 'en',
  flavour: 'maxi',
  autoUpdate: true,
  checkIntervalHours: 24,
  downloadConnections: 8, // simultaneous connections for edition downloads (1 = the old single-connection method)
  keepInTray: true,
  launchAtLogin: true,
  enginePath: null,
  tour: { hide: false, seenVersion: null }, // the guided tour: switched off? and the version it was last shown in
  hub: { seenVersion: null, want: null, running: false }, // the Setup page: the version it last opened itself in, what was ticked, and whether "download all" is under way
  // everyHours: how often the contacts accounts are read again. lookup: whether addresses the downloaded data cannot
  // place may be looked up online (null until the user has been asked, then true or false).
  contacts: { everyHours: 24, lookup: null },
  ai: {
    enabled: true,
    provider: 'foundry',
    foundryModel: 'phi-4-mini',
    foundryModelId: null,
    foundryModelFor: null,
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    apiKey: '',
    contextChars: 6000,
    maxAnswerTokens: 400,
    rewriteQueries: true,
    speedTests: {}, // measured on this computer, by exact build id
    tuning: null,   // what "Tune for this computer" last measured and chose
    tunePreference: 2, // 0 fastest answers ... 4 most thorough answers; sets the targets tuning aims for
    idleMinutes: 3, // take the model out of memory after this long without a question; 0 keeps it loaded
    autoSetup: null, // 'pending' once the person has agreed to set answers up; then 'done' or 'failed'
  },
};

let settings = structuredClone(DEFAULTS);
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...DEFAULTS, ...saved, ai: { ...DEFAULTS.ai, ...(saved.ai || {}) }, tour: { ...DEFAULTS.tour, ...(saved.tour || {}) }, hub: { ...DEFAULTS.hub, ...(saved.hub || {}) }, contacts: { ...DEFAULTS.contacts, ...(saved.contacts || {}) } };
  } catch { /* first run */ }
  if (process.env.WIKIVAULT_BASE_URL) settings.baseUrl = process.env.WIKIVAULT_BASE_URL;
}

// Decided once per start, from what the settings said when the app opened.
let tourRun = null;
function tourThisRun() {
  if (!tourRun) tourRun = { ...tourPlan(settings.tour, app.getVersion()), done: false };
  return { show: tourRun.show && !tourRun.done, whatsNew: tourRun.whatsNew };
}

function saveSettings() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  syncRegistry();
}

/**
 * The uninstaller cannot read settings.json, so the few facts it needs (where
 * the library is, whether a partition exists) are mirrored to the registry.
 */
function syncRegistry() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const values = {
    DataDir: settings.dataDir || '',
    StagingDir: settings.stagingDir || '',
    Partition: settings.partition?.driveLetter || '',
  };
  for (const [name, value] of Object.entries(values)) {
    execFile('reg.exe', ['add', 'HKCU\\Software\\Wikivault', '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true }, () => {});
  }
}

function defaultDataDir() {
  // Roaming profiles are the wrong place for 100+ GB, so prefer LocalAppData on Windows.
  const base = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Wikivault')
    : app.getPath('userData');
  return path.join(base, 'library');
}

/** Where staged updates are downloaded: on the system drive, outside the library's partition. */
function defaultStagingDir() {
  return path.join(path.dirname(defaultDataDir()), 'staging');
}

// ---------------------------------------------------------------- logging

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  if (!app.isPackaged) process.stdout.write(line);
  try {
    const file = path.join(app.getPath('userData'), 'wikivault.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, line);
  } catch { /* logging must never break the app */ }
}

// ---------------------------------------------------------------- state

let win = null;
let tray = null;
let quitting = false;
let editions = null;
let engine = null;

// Other Kiwix libraries that can be kept alongside Wikipedia. Each has its own folder, its own
// edition manager (download, verify, update) and its own reader engine; one library is open at a time.
const LIBRARIES = {
  wikibooks: { name: 'Wikibooks', project: 'wikibooks', approxBytes: 6 * 2 ** 30, about: 'Free textbooks and manuals: first aid, cooking, gardening, repairs, languages, mathematics, science and much more.' },
  wikiversity: { name: 'Wikiversity', project: 'wikiversity', approxBytes: 3 * 2 ** 30, about: 'Courses, lessons and learning material arranged by subject and level.' },
};
const extras = new Map();   // id -> { manager, engine }
const extraLatest = {};     // id -> { date, file, bytes } as last read from Kiwix
let activeLib = 'wikipedia';
/** The engine of the library that is open: the chosen extra one if it is running, else Wikipedia's. */
// Wiki golf: one round at a time, played in the library that was open when it started.
let golf = null;            // { game, engine, libId }
function golfState() {
  if (golf && !golf.engine?.running) golf = null; // the library was switched to a new edition or removed
  return golf ? golf.game.snapshot() : null;
}
async function layGolfHole() {
  const g = golf;
  if (!g) return;
  g.game.error = null;
  pushState();
  try {
    const e = g.engine;
    const hole = await makeHole({ getPage: (url) => e.fetchHtml(url), randomUrl: e.randomUrl(), contentBase: e.contentBase(), steps: g.game.stepsForNext() });
    if (golf !== g || g.game.phase !== 'layout') return;
    g.game.setHole(hole);
    log(`golf: hole ${g.game.holeIndex + 1} laid out, par ${hole.par}: ${hole.start.url} -> ${hole.target.url}`);
  } catch (err) {
    log(`golf: hole could not be laid out: ${err.message}`);
    if (golf === g) g.game.layoutFailed(err.message);
  }
  pushState();
}
// Saved players and their records live beside the settings, in golf.json.
let golfStoreObj = null;
function clubStore() {
  if (!golfStoreObj) golfStoreObj = new GolfStore(path.join(app.getPath('userData'), 'golf.json'), { log });
  return golfStoreObj;
}
const golfClub = () => ({ players: clubStore().list(), characters: CHARACTERS, colours: COLOURS });
const golfInPlay = () => Boolean(golfState() && golf.game.phase !== 'finished');

/**
 * A link that points at another Wikimedia project. When that project is downloaded and has the
 * page, the reader goes there and the open library changes with it. Returns true when it did;
 * otherwise a short reason for the notice, or null when the link is simply a web link.
 */
async function followSisterLink(url) {
  const link = sisterLink(url, settings.language || 'en');
  if (!link) return null;
  const name = link.project === 'wikipedia' ? 'Wikipedia' : LIBRARIES[link.project]?.name;
  const eng = link.project === 'wikipedia' ? engine : extras.get(link.project)?.engine;
  if (!name) return null;
  if (!eng?.running) return link.project === 'wikipedia' ? null : `${name} is not downloaded. It can be added under Library, More libraries.`;
  if (golfInPlay()) return 'Links to other libraries are switched off during a round of wiki golf.';
  for (const candidate of pathCandidates(link.path)) {
    const page = eng.urlForPath(candidate);
    try {
      const r = await fetchText(page, { timeoutMs: 8000, allowError: true, maxBytes: 24 * 1024 * 1024 });
      if (r.status !== 200) continue;
      const switched = curLibId() !== link.project;
      if (switched) { activeLib = link.project; conversation.length = 0; pushState(); }
      send('open-url', { url: `${r.url || page}${link.hash}`, switched });
      return true;
    } catch { /* try the next spelling */ }
  }
  return `That page is not in the offline copy of ${name}.`;
}

const cur = () => (extras.get(activeLib)?.engine?.running ? extras.get(activeLib).engine : engine);
const curLibId = () => (extras.get(activeLib)?.engine?.running ? activeLib : 'wikipedia');
let engineState = { installing: null, error: null, version: null };
let engineRestarts = [];
let blockerId = null;
let stateTimer = null;
const asks = new Map();
let askSeq = 0;
// The current Ask conversation. Lives in memory only: it is never written to disk,
// and it is gone when the person starts a new conversation or the app closes.
let conversation = [];
/** The place the last map request in Ask was about, for a "there" in the next one. Forgotten with the conversation. */
let lastMapPlace = null;
const MAX_TURNS = 8;
let aiBusy = null;
let aiResting = false;      // the model was taken out of memory while idle; it loads again on the next question
let lastAiUse = Date.now();
// A long-running library operation (move, or returning the partition), shown on the Library page.
let maintenance = null;

// Optional dedicated partition (Windows). WIKIVAULT_PARTITION_SIM swaps in a pretend drive for development.
const partitionSim = process.env.WIKIVAULT_PARTITION_SIM || null;
const partitionTool = partitionSim ? new SimulatedPartitionTool(partitionSim) : new PartitionTool({ log });
const partitionAvailable = () => process.platform === 'win32' || Boolean(partitionSim);
const systemLetter = () => (process.env.SystemDrive || 'C:').charAt(0).toUpperCase();
let editionSizeCache = null;

/** Size of the edition that would be downloaded, asked from the server; an estimate if it cannot be reached. */
async function editionSize() {
  if (editionSizeCache) return editionSizeCache;
  if (partitionSim) {
    try { const s = JSON.parse(fs.readFileSync(partitionSim, 'utf8')); if (s.editionBytes) return { bytes: s.editionBytes, known: true }; } catch { /* use the server */ }
  }
  try {
    const latest = await catalog.findLatestEdition({ baseUrl: settings.baseUrl, language: settings.language, flavour: settings.flavour });
    const bytes = await catalog.fetchRemoteSize(latest.url);
    if (bytes) { editionSizeCache = { bytes, known: true }; return editionSizeCache; }
  } catch { /* offline: fall through */ }
  return { bytes: FALLBACK_EDITION_BYTES, known: false };
}

/**
 * The three sizes Kiwix publishes English Wikipedia in, with the real size of the newest edition of
 * each. When Kiwix cannot be reached the sizes are estimates from Kiwix's own stated proportions.
 */
const FLAVOURS = [
  { flavour: 'maxi', share: 1 },      // every article, with images
  { flavour: 'nopic', share: 0.25 },  // every article, no images: "about 75% smaller"
  { flavour: 'mini', share: 0.05 },   // introductions and infoboxes only: "about 95% smaller"
];
async function flavourSizes() {
  const found = await Promise.all(FLAVOURS.map(async ({ flavour }) => {
    try {
      const latest = await catalog.findLatestEdition({ baseUrl: settings.baseUrl, language: settings.language, flavour });
      const bytes = await catalog.fetchRemoteSize(latest.url);
      return bytes ? { flavour, bytes, date: latest.date, known: true } : null;
    } catch { return null; }
  }));
  if (found.some(Boolean)) return found.filter(Boolean); // only what Kiwix really offers right now
  return FLAVOURS.map(({ flavour, share }) => ({ flavour, bytes: Math.round(FALLBACK_EDITION_BYTES * share), date: null, known: false }));
}

/** "maxi", "nopic" or "mini" from an edition's file name; null for a file the user supplied under another name. */
const flavourOf = (file) => (/_(maxi|nopic|mini)_\d{4}-\d{2}\.zim$/i.exec(file || '') || [])[1]?.toLowerCase() || null;

/**
 * The sizes Wikipedia can be switched to from the Library page, and whether each can be fetched
 * with the copy in use kept until the new one has been checked.
 */
async function flavourOptions() {
  const sizes = await flavourSizes();
  const active = editions?.snapshot().active || null;
  const current = flavourOf(active?.file);
  const staged = Boolean(settings.stagingDir && libraryOnPartition());
  const libFree = await freeAt(settings.dataDir);
  const stageFree = staged ? await freeAt(settings.stagingDir) : null;
  const gb = (n) => `${(n / 2 ** 30).toFixed(n < 10 * 2 ** 30 ? 1 : 0)} GB`;
  return {
    current, wanted: settings.flavour, hasEdition: Boolean(active),
    options: sizes.map((f) => {
      let fits = true;
      let why = '';
      if (active && f.flavour !== current) {
        if (staged) {
          const stageDrive = path.parse(path.resolve(settings.stagingDir)).root.replace(/[\\/]+$/, '') || 'the system drive';
          if (stageFree != null && stageFree < f.bytes + 5 * 2 ** 30) { fits = false; why = `It is downloaded to ${stageDrive} and checked there first. That needs ${gb(f.bytes)} and ${stageDrive} has ${gb(stageFree)} free.`; }
          else if (libFree != null && libFree + (active.bytes || 0) < f.bytes * 1.02) { fits = false; why = `The Wikivault partition is too small for it: ${gb(libFree + (active.bytes || 0))} once the current copy is gone, and it needs ${gb(f.bytes)}.`; }
        } else if (libFree != null && libFree < f.bytes + 2 * 2 ** 30) {
          fits = false;
          why = `The copy you have is kept until the new one is checked, so it needs ${gb(f.bytes)} free and the library drive has ${gb(libFree)}.`;
        }
      }
      return { ...f, current: f.flavour === current, fits, why };
    }),
  };
}

async function changeFlavour(flavour) {
  if (!FLAVOURS.some((f) => f.flavour === flavour)) throw new Error('Unknown edition size.');
  if (!editions?.snapshot().active) throw new Error('Set up the library first.');
  if (maintenance && !maintenance.error) throw new Error('The library is being moved. Try again when that has finished.');
  const info = await flavourOptions();
  const pick = info.options.find((o) => o.flavour === flavour);
  if (!pick) throw new Error('Kiwix does not offer that size at the moment.');
  if (!pick.fits) throw new Error(pick.why);
  // A download of another size that is under way or paused is dropped.
  if (editions.snapshot().pending || isBusy()) await editions.cancel();
  settings.flavour = flavour;
  editionSizeCache = null;
  saveSettings();
  await editions.forgetLatest();
  log(`wikipedia size: ${flavour}${pick.current ? ' (already installed)' : ''}`);
  if (!pick.current) editions.update().catch((err) => log(`size change: ${err.message}`));
  pushState();
  return true;
}

/** Live power state. Read fresh every time, so plugging in the charger takes effect at once. */
function onBattery() {
  if (partitionSim) {
    try { return Boolean(JSON.parse(fs.readFileSync(partitionSim, 'utf8')).onBattery); } catch { return false; }
  }
  try { return powerMonitor.isOnBatteryPower(); } catch { return false; }
}

async function partitionInfo() {
  const driveLetter = systemLetter();
  const [analysis, edition] = await Promise.all([partitionTool.analyze(driveLetter), editionSize()]);
  // Wikibooks and Wikiversity live on the same partition: count the ones already downloaded, and
  // recommend room for all of them with an update of each in progress.
  let otherBytes = 0;
  let otherAllowance = 0;
  for (const [id, lib] of Object.entries(LIBRARIES)) {
    const have = extras.get(id)?.manager.snapshot().active?.bytes || 0;
    otherBytes += have;
    otherAllowance += 2 * 1.15 * Math.max(have, extraLatest[id]?.bytes || lib.approxBytes);
  }
  if (schoolBytes() > 0) { otherBytes += schoolBytes(); otherAllowance += schoolBytes(); }
  if (mapsBytes() > 0) { otherBytes += mapsBytes(); otherAllowance += mapsBytes(); }
  const base = { editionBytes: edition.bytes, volumeFree: analysis.volumeFree, partitionSize: analysis.partitionSize, sizeMin: analysis.sizeMin, otherBytes, otherAllowance };
  const plans = { staged: sizePlan({ ...base, editions: 1 }), selfContained: sizePlan({ ...base, editions: 2 }) };
  return { driveLetter, analysis, edition, plans, base, stagingDir: defaultStagingDir() };
}

/** True once the library has a home: from then on the school files, the map and the rest have somewhere to go, even while Wikipedia is still downloading. */
const libraryChosen = () => Boolean(settings.dataDir && editions);

/** What the library holds, by part. */
function libraryBreakdown() {
  const wikipedia = editions?.snapshot().active?.bytes || 0;
  let others = 0;
  for (const id of Object.keys(LIBRARIES)) others += extras.get(id)?.manager.snapshot().active?.bytes || 0;
  const schoolPart = schoolBytes(); const mapsPart = mapsBytes();
  return { wikipedia, others, school: schoolPart, maps: mapsPart, total: wikipedia + others + schoolPart + mapsPart };
}

/**
 * What giving the library a partition, or changing the size of the one it has, would involve now.
 *
 * Windows can only grow a partition into free space that follows it, and the library's partition sits
 * directly after the Windows drive, so neither can be stretched into the other's space. A change of size
 * is therefore a rebuild: the library moves to a folder on the Windows drive, the partition is removed
 * and made again at the new size, and the library moves back. This works out what that needs.
 */
async function partitionPlan() {
  if (!partitionAvailable()) throw new Error('Partitions can only be managed on Windows.');
  if (!editions?.snapshot().active) throw new Error('Set up the library first.');
  const info = await partitionInfo();
  const a = info.analysis;
  const lib = libraryBreakdown();
  const p = settings.partition;
  const onPart = Boolean(p) && libraryOnPartition();
  const src = info.driveLetter;
  const sameDrive = (dir) => Boolean(partitionSim) || path.resolve(String(dir)).slice(0, 2).toUpperCase() === `${src}:`;
  const libOnSource = !onPart && sameDrive(settings.dataDir);
  const old = onPart ? p.sizeBytes : 0;
  const tempDir = defaultDataDir();
  // Room on the Windows drive once all is done, before the partition is taken out of it.
  const freeAfterAll = a.volumeFree + old + (libOnSource ? lib.total : 0);
  // Room at the moment the drive is shrunk: by then the library is on it, if it was not already.
  const freeAtShrink = a.volumeFree + old - (onPart && sameDrive(tempDir) ? lib.total : 0);
  const base = { ...info.base, editionBytes: Math.max(info.base.editionBytes, lib.wikipedia), volumeFree: freeAfterAll, partitionSize: a.partitionSize + old, sizeMin: onPart ? null : a.sizeMin };
  const cap = freeAtShrink - 2 * GB;
  const plans = { staged: capPlan(sizePlan({ ...base, editions: 1 }), cap, src), selfContained: capPlan(sizePlan({ ...base, editions: 2 }), cap, src) };
  const tempNeeded = onPart ? lib.total + 2 * GB : 0;
  const tempFree = onPart ? await freeAt(tempDir) : null;
  return {
    mode: onPart ? 'resize' : p ? 'blocked' : 'create',
    source: src, sourceSize: a.partitionSize, sourceFree: a.volumeFree, freeAfterAll,
    current: p ? { driveLetter: p.driveLetter, sizeBytes: p.sizeBytes, free: onPart ? await freeAt(settings.dataDir) : null } : null,
    library: lib, dataDir: settings.dataDir, plans,
    tempDir, tempNeeded, tempFree, tempOk: !onPart || tempFree == null || tempFree >= tempNeeded,
    staged: Boolean(settings.stagingDir), onBattery: onBattery(),
  };
}

const llm = new LlmService({
  getSettings: () => settings.ai,
  saveSettings: (patch) => { Object.assign(settings.ai, patch); saveSettings(); },
  log,
});

/**
 * The size and free room of the drive the library is on, for the Setup page. When the library has a partition of
 * its own, that is its drive, and the drive the partition was cut from is given as well.
 */
async function diskInfo(probeDir) {
  const stat = async (dir) => {
    try { const s = await fsp.statfs(dir); const total = Number(s.blocks) * Number(s.bsize); return total > 0 ? { total, free: Number(s.bavail) * Number(s.bsize), root: path.parse(path.resolve(dir)).root } : null; } catch { return null; }
  };
  const library = await stat(probeDir);
  const onPartition = libraryOnPartition();
  let main = null;
  if (onPartition && settings.partition && settings.partition.sourceLetter) main = await stat(`${settings.partition.sourceLetter}:\\`);
  if (main && library && main.root.toLowerCase() === library.root.toLowerCase()) main = null;
  return { library, main, onPartition };
}

// Hardware the app can point people to: a name and a web link, kept in one file so that it is changed in one place.
const GEAR = (() => {
  const web = (g) => (g && /^https:\/\//i.test(String(g.url || '')) ? { name: String(g.name || '').slice(0, 120), url: String(g.url), seller: String(g.seller || '').slice(0, 40), note: String(g.note || '').slice(0, 200) } : null);
  try { const all = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'gear.json'), 'utf8')); return { gps: web(all.gps) }; } catch { return { gps: null }; }
})();

// Which parts of the app are in this build, on this computer (see core/features.js). Read once the settings are in.
let featuresRead = null;
function featuresNow() {
  if (!featuresRead) featuresRead = features({ pkg: require('../../package.json'), settings, env: process.env });
  return featuresRead;
}

async function getState() {
  const dir = settings.dataDir || defaultDataDir();
  let probeDir = dir;
  while (!fs.existsSync(probeDir) && path.dirname(probeDir) !== probeDir) probeDir = path.dirname(probeDir);
  const pub = { ...settings, ai: { ...settings.ai, apiKey: settings.ai.apiKey ? '•••' : '' } };
  return {
    version: app.getVersion(),
    gear: GEAR,
    features: featuresNow(),
    acknowledged: Number(settings.acknowledged) >= TERMS_VERSION,
    tour: { ...tourThisRun(), auto: !settings.tour.hide },
    platform: process.platform,
    packaged: app.isPackaged,
    partitionAvailable: partitionAvailable(),
    libraryBytes: libraryBreakdown().total,
    libraryParts: libraryBreakdown(),
    disk: await diskInfo(probeDir),
    onBattery: onBattery(),
    settings: pub,
    suggestedDataDir: dir,
    freeBytes: await freeBytes(probeDir),
    edition: editions ? editions.snapshot() : null,
    engine: {
      ready: Boolean(cur()?.running),
      origin: cur()?.running ? cur().origin : null,
      homeUrl: cur()?.running ? cur().homeUrl() : null,
      randomUrl: cur()?.running ? cur().randomUrl() : null,
      info: engine?.running ? engine.info : null,
      ...engineState,
    },
    activeLibrary: curLibId(),
    golf: golfState(),
    school: school ? { ...school.status(), dir: school.dir } : null,
    maps: maps ? { ...maps.status(), dir: maps.dir, origin: schoolServer ? schoolServer.origin : null } : null,
    golfClub: golfClub(),
    libraries: Object.entries(LIBRARIES).map(([id, lib]) => {
      const x = extras.get(id);
      const snap = x?.manager.snapshot();
      return { id, name: lib.name, about: lib.about, ready: Boolean(x?.engine?.running), phase: snap?.phase || 'idle', active: snap?.active || null, pending: snap?.pending || null, progress: snap?.progress || null, error: snap?.error || null, updateAvailable: Boolean(snap?.updateAvailable), latest: extraLatest[id] || null };
    }),
    ai: { ...llm.status(), busy: aiBusy, tune: tuneProgress, resting: aiResting && llm.status().state !== 'ready' },
    book: bookState(),
    gpsFake: Boolean(process.env.WIKIVAULT_GPS_FAKE),
    partition: settings.partition,
    libraryOnPartition: libraryOnPartition(),
    maintenance,
    defaultLibraryDir: defaultDataDir(),
  };
}

// Snapshots are sent one at a time, so a slow one can never arrive after a newer one.
let stateSending = false;
let stateAgain = false;
function pushState() {
  if (stateTimer) return;
  stateTimer = setTimeout(async () => {
    stateTimer = null;
    if (stateSending) { stateAgain = true; return; }
    stateSending = true;
    try {
      do {
        stateAgain = false;
        const snapshot = await getState();
        if (win && !win.isDestroyed()) win.webContents.send('state', snapshot);
      } while (stateAgain);
    } catch (err) { log(`state: ${err.message}`); } finally { stateSending = false; }
  }, 120);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------------------------------------------------------------- engine

const engineDir = () => path.join(app.getPath('userData'), 'engine');
const enginePidFile = () => path.join(app.getPath('userData'), 'engine.json');

/** If a previous run crashed, its engine may still hold the edition file open. */
async function reapOrphanEngine() {
  try {
    const { pid, port } = JSON.parse(await fsp.readFile(enginePidFile(), 'utf8'));
    const r = await fetchText(`http://127.0.0.1:${port}/catalog/v2/entries`, { timeoutMs: 1500, allowError: true });
    if (r.status === 200 && /opds/i.test(r.text)) { process.kill(pid); log(`stopped leftover engine ${pid}`); }
  } catch { /* nothing to clean up */ }
  await fsp.rm(enginePidFile(), { force: true });
}

async function ensureEngineBinary() {
  let bin = await locateEngine({ configuredPath: settings.enginePath, engineDir: engineDir() });
  if (bin) return bin;
  if (process.platform !== 'win32') {
    throw new Error('kiwix-serve was not found. Install kiwix-tools, or set WIKIVAULT_KIWIX_SERVE to its path.');
  }
  engineState = { ...engineState, installing: { step: 'Finding the reader engine' }, error: null };
  pushState();
  try {
    const res = await installEngine({
      engineDir: engineDir(), baseUrl: settings.baseUrl,
      onProgress: (p) => { engineState = { ...engineState, installing: p }; pushState(); },
    });
    bin = res.path;
    engineState = { installing: null, error: null, version: res.version };
    log(`engine installed: ${bin}`);
    return bin;
  } catch (err) {
    engineState = { ...engineState, installing: null, error: `The reader engine could not be downloaded: ${err.message}` };
    pushState();
    throw err;
  }
}

async function startEngine(zimPath) {
  const bin = await ensureEngineBinary();
  if (engine) { engine.removeAllListeners('crash'); await engine.stop(); }
  const next = new Engine({ binPath: bin, log });
  await next.start(zimPath);
  engine = next;
  engineState = { ...engineState, error: null };
  await fsp.writeFile(enginePidFile(), JSON.stringify({ pid: next.proc.pid, port: next.port })).catch(() => {});
  next.on('crash', async (err) => {
    log(`engine crashed: ${err.message}`);
    const now = Date.now();
    engineRestarts = engineRestarts.filter((t) => now - t < 60000);
    if (quitting || engineRestarts.length >= 3) {
      engineState = { ...engineState, error: 'The reader engine keeps stopping. Restart Wikivault; if it happens again, the edition file may be damaged.' };
      return pushState();
    }
    engineRestarts.push(now);
    try { await startEngine(zimPath); } catch (e) { engineState = { ...engineState, error: e.message }; }
    return pushState();
  });
  lockReaderSession();
  pushState();
  send('edition-switched', { homeUrl: next.homeUrl() });
}

// ---------------------------------------------------------------- library

async function initLibrary() {
  if (editions) { editions.stopSchedule(); editions.removeAllListeners(); }
  await closeExtras();
  editions = new EditionManager({
    dataDir: settings.dataDir,
    getSettings: () => settings,
    probe: async (file) => probeZim(await ensureEngineBinary(), file, { log }),
    activate: startEngine,
    log,
  });
  editions.on('change', (s) => {
    const busy = ['downloading', 'verifying', 'switching', 'moving'].includes(s.phase);
    if (busy && blockerId == null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
    if (!busy && blockerId != null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
    pushState();
    updateTray();
  });
  const snap = await editions.init();
  if (snap.active) {
    try { await startEngine(snap.active.path); } catch (err) {
      log(`could not start engine: ${err.message}`);
      engineState = { ...engineState, error: engineState.error || err.message };
    }
  }
  editions.startSchedule();
  pushState();
  // Extra libraries downloaded earlier are opened too.
  await Promise.all(Object.keys(LIBRARIES)
    .filter((id) => fs.existsSync(path.join(extraDir(id), 'state.json')))
    .map((id) => ensureExtra(id).catch((err) => log(`${id}: ${err.message}`))));
  await initSchool().catch((err) => log(`school: ${err.stack || err.message}`));
  await initMaps().catch((err) => log(`maps: ${err.stack || err.message}`));
}

/** Stop every extra library's engine and updater, leaving its files alone. */
async function closeExtras() {
  for (const x of extras.values()) {
    x.manager.stopSchedule();
    x.manager.removeAllListeners();
    if (x.engine) { x.engine.removeAllListeners('crash'); await x.engine.stop().catch(() => {}); }
  }
  extras.clear();
}

// ---------------------------------------------------------------- more libraries

const extraDir = (id) => path.join(settings.dataDir, 'more', id);

async function startExtraEngine(id, zimPath) {
  const x = extras.get(id);
  const bin = await ensureEngineBinary();
  if (x.engine) { x.engine.removeAllListeners('crash'); await x.engine.stop(); }
  const next = new Engine({ binPath: bin, log });
  await next.start(zimPath, { threads: 4 });
  x.engine = next;
  next.on('crash', (err) => {
    log(`${id} engine stopped: ${err.message}`);
    x.engine = null;
    pushState();
    if (activeLib === id) { activeLib = 'wikipedia'; if (engine?.running) send('edition-switched', { homeUrl: engine.homeUrl() }); }
  });
  lockReaderSession();
  pushState();
  if (activeLib === id) send('edition-switched', { homeUrl: next.homeUrl() });
}

/** The edition manager for one extra library, created on first use and opened if already downloaded. */
async function ensureExtra(id) {
  if (!LIBRARIES[id]) throw new Error('Unknown library.');
  if (extras.has(id)) return extras.get(id);
  const x = { engine: null, manager: null };
  x.manager = new EditionManager({
    dataDir: extraDir(id),
    // Same servers and update rhythm as Wikipedia. Never staged: these are small next to Wikipedia.
    getSettings: () => ({ ...settings, project: LIBRARIES[id].project, flavour: 'maxi', stagingDir: null }),
    probe: async (file) => probeZim(await ensureEngineBinary(), file, { log }),
    activate: (zimPath) => startExtraEngine(id, zimPath),
    log: (m) => log(`${id}: ${m}`),
  });
  x.manager.on('change', () => pushState());
  extras.set(id, x);
  const snap = await x.manager.init();
  if (snap.active) await startExtraEngine(id, snap.active.path).catch((err) => log(`${id}: could not open: ${err.message}`));
  x.manager.startSchedule();
  pushState();
  return x;
}

/** Newest edition of an extra library on Kiwix and its size, for the Library page. */
async function extraInfo(id) {
  const lib = LIBRARIES[id];
  if (!lib) throw new Error('Unknown library.');
  const latest = await catalog.findLatestEdition({ baseUrl: settings.baseUrl, project: lib.project, language: settings.language, flavour: 'maxi' });
  const bytes = await catalog.fetchRemoteSize(latest.url);
  const info = { date: latest.date, file: latest.file, bytes: bytes || null };
  extraLatest[id] = info;
  return info;
}

async function downloadExtra(id) {
  if (!editions?.snapshot().active) throw new Error('Set up Wikipedia first; other libraries are kept alongside it.');
  const info = await extraInfo(id);
  const free = await freeBytes(settings.dataDir);
  if (info.bytes && free != null && free < info.bytes * 1.1) throw new Error(`${LIBRARIES[id].name} needs ${(info.bytes / 2 ** 30).toFixed(1)} GB and the library drive has ${(free / 2 ** 30).toFixed(1)} GB free.`);
  const x = await ensureExtra(id);
  x.manager.update().catch((err) => log(`${id}: ${err.message}`));
  return true;
}

async function removeExtra(id) {
  const x = extras.get(id);
  if (activeLib === id) { activeLib = 'wikipedia'; if (engine?.running) send('edition-switched', { homeUrl: engine.homeUrl() }); }
  if (x) {
    x.manager.stopSchedule();
    await x.manager.cancel().catch(() => {});
    x.manager.removeAllListeners();
    if (x.engine) { x.engine.removeAllListeners('crash'); await x.engine.stop().catch(() => {}); }
    extras.delete(id);
  }
  await removeLibraryFiles(extraDir(id)).catch((err) => log(`${id}: ${err.message}`));
  await fsp.rmdir(path.join(settings.dataDir, 'more')).catch(() => {}); // only if now empty
  pushState();
  return true;
}

// ---------------------------------------------------------------- school
// A year of lessons from free curriculum files (see assets/school). The files live in the library
// folder, are shown by a small file server on 127.0.0.1, and are read into a text index by a
// separate process.

let school = null;         // SchoolLibrary for the grade in use
let schoolServer = null;   // { origin }
let schoolOpens = 0;
let indexer = null;
let indexSeq = 0;
const indexWaiting = new Map();
const SCHOOL_GRADE = 'grade5';
// Chromium's own PDF viewer, and the styles and scripts it takes from the browser itself. Neither leaves this computer.
const PDF_VIEWER = /^(chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/|chrome:\/\/resources\/)/;

/** Read a PDF's pages in the indexer process, started on first use and stopped when the work is done. */
function extractInChild(file) {
  if (!indexer) {
    indexer = utilityProcess.fork(path.join(__dirname, 'school-indexer.js'), [], { serviceName: 'Wikivault school index' });
    indexer.on('message', (m) => {
      const w = indexWaiting.get(m.id);
      if (!w) return;
      indexWaiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m.pages);
    });
    indexer.on('exit', () => {
      indexer = null;
      for (const w of indexWaiting.values()) w.reject(new Error('The process that reads the files stopped.'));
      indexWaiting.clear();
    });
  }
  return new Promise((resolve, reject) => { const id = ++indexSeq; indexWaiting.set(id, { resolve, reject }); indexer.postMessage({ id, file }); });
}
function stopIndexer() { try { indexer?.kill(); } catch { /* already gone */ } indexer = null; }

function startSchoolServer() {
  if (schoolServer) return Promise.resolve(schoolServer);
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const m = /^\/f\/([a-z0-9-]+)\.pdf$/.exec(pathname);
    const f = m && school?.fileById(m[1]);
    let file = f && school.have.has(f.id) ? school.pathOf(f) : null;
    let type = 'application/pdf';
    // The map view runs in the app's own window, which is not this server's origin.
    const open = pathname.startsWith('/m/') ? { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-expose-headers': 'content-range, content-length, etag' } : {};
    if (pathname.startsWith('/m/')) {
      if (req.method === 'OPTIONS') { res.writeHead(204, open).end(); return; }
      const font = /^\/m\/fonts\/([A-Za-z ]+)\/(\d+-\d+)\.pbf$/.exec(pathname);
      const sprite = /^\/m\/sprites\/([a-z]+(?:@2x)?\.(?:json|png))$/.exec(pathname);
      if (pathname === '/m/map.pmtiles' && maps?.map) { file = maps.mapFile; type = 'application/octet-stream'; }
      else if (font) {
        file = path.join(MAP_ASSETS, 'fonts', font[1], `${font[2]}.pbf`); type = 'application/x-protobuf';
        // Only Latin letters are packed with the app. Any other range is answered with "no glyphs", which the map accepts.
        if (!fs.existsSync(file)) { res.writeHead(200, { ...open, 'content-type': type, 'content-length': 0 }).end(); return; }
      } else if (sprite) { file = path.join(MAP_ASSETS, 'sprites', sprite[1]); type = sprite[1].endsWith('.json') ? 'application/json' : 'image/png'; }
      else file = null;
    }
    let size = 0;
    try { size = file ? fs.statSync(file).size : 0; } catch { size = 0; }
    if (!size || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404, { ...open, 'content-type': 'text/plain' }).end('Not here'); return; }
    const head = { ...open, 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0;
    let end = size - 1;
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); } else start = Math.max(0, size - Number(range[2]));
      if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    } else res.writeHead(200, { ...head, 'content-length': size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { schoolServer = { origin: `http://127.0.0.1:${server.address().port}`, server }; resolve(schoolServer); });
  });
}

let maps = null;
let routeEngine = null;
// The routing engine and its profiles are read by Java, which cannot look inside the app's archive.
const ROUTING_ASSETS = path.join(__dirname, '..', '..', 'assets', 'routing').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
/** Java comes with the installed app; when run from source, the one on this machine is used. */
const javaPath = () => process.env.WIKIVAULT_JAVA || (app.isPackaged ? path.join(process.resourcesPath, 'java', 'bin', 'java.exe') : 'java');
function stopRouteEngine() { if (routeEngine) { routeEngine.stop(); routeEngine = null; } }
function getRouteEngine() {
  if (!routeEngine) routeEngine = new RouteEngine({ java: javaPath(), jar: path.join(ROUTING_ASSETS, 'brouter.jar'), profiles: path.join(ROUTING_ASSETS, 'profiles2'), segments: maps.segmentsDir, scratch: path.join(app.getPath('userData'), 'routing-scratch'), log });
  return routeEngine;
}
const MAP_ASSETS = path.join(__dirname, '..', '..', 'assets', 'maps');
async function initMaps() {
  if (maps) { maps.cancel(); maps.removeAllListeners(); await maps.closeArchive(); } // the map file must not stay open: on Windows an open file cannot be moved or deleted
  stopRouteEngine();
  // Tests fetch from a stand-in server instead of the map and places servers.
  const base = process.env.WIKIVAULT_MAPS_BASE;
  maps = new MapsLibrary({
    dir: path.join(settings.dataDir, 'maps'), log, agent: `Wikivault/${app.getVersion()} (offline map for personal use)`,
    ...(base ? { base } : {}),
    ...(base ? { pause: () => new Promise((r) => setTimeout(r, 20)) } : {}),
  });
  let last = 0;
  maps.on('changed', () => pushState());
  maps.on('progress', () => { const now = Date.now(); if (now - last > 400) { last = now; pushState(); } });
  maps.onRoutingSwap = async () => { stopRouteEngine(); await new Promise((r) => setTimeout(r, 300)); };
  await maps.init();
  refreshPlacing(false);
}
/**
 * After anything that changes which addresses can be found (new address data, new places, a new version of
 * the app): work out the towns of the address data if that is still to do, then try the saved entries again.
 */
function refreshPlacing(always = true) {
  if (!maps) return;
  maps.buildGazetteer().catch(() => false).then((built) => {
    if (!book) return;
    // Each version may read addresses better than the last, so the first start of a new one tries again too.
    if (!always && !built && book.placedBy === app.getVersion()) return;
    book.placedBy = app.getVersion();
    const r = book.locateAll();
    log(`address book: entries placed again, ${r.found} more now on the map (${r.located} of ${r.withAddress} with an address)`);
    pushState();
    lookupAddresses().catch(() => {});
  });
}
const mapsBytes = () => (maps ? maps.status().bytes : 0);

async function initSchool() {
  if (school) { school.cancel(); school.removeAllListeners(); }
  stopIndexer();
  // School is still being built: a build that leaves it out starts none of it. Files already on the disk are left alone.
  if (!featuresNow().school) { school = null; return; }
  const manifest = schoolCore.loadManifest(path.join(schoolCore.MANIFEST_DIR, `${SCHOOL_GRADE}.json`));
  // Tests fetch from a stand-in server instead of the publisher.
  const base = process.env.WIKIVAULT_SCHOOL_BASE;
  school = new SchoolLibrary({
    dir: path.join(settings.dataDir, 'school'), manifest, extract: extractInChild, log,
    rewrite: (u) => (base ? u.replace(/^https:\/\/www\.coreknowledge\.org/, base) : u),
  });
  let wasBusy = false;
  school.on('change', (st) => {
    if (wasBusy && !st.job) stopIndexer();
    wasBusy = Boolean(st.job);
    pushState();
  });
  await school.init();
  // Files that arrived without being read (the app was closed mid-way) are read now.
  school.indexMissing().catch((err) => log(`school index: ${err.message}`));
}
const schoolBytes = () => (school ? school.status().bytes : 0);

/** Free space on the drive a folder is (or will be) on, whether or not the folder exists yet. */
async function freeAt(dir) {
  let probe = path.resolve(String(dir || ''));
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  return freeBytes(probe);
}

// ---------------------------------------------------------------- security

const isEngineUrl = (url) => {
  try {
    const { origin } = new URL(url);
    if (schoolServer && origin === schoolServer.origin) return true;
    return [engine, ...[...extras.values()].map((x) => x.engine)].some((e) => e?.running && e.origin === origin);
  } catch { return false; }
};

let readerLocked = false;
/** Article pages may only load from the engine on this machine. Everything else is cancelled. */
function lockReaderSession() {
  if (readerLocked) return;
  readerLocked = true;
  const reader = session.fromPartition('persist:reader');
  reader.webRequest.onBeforeRequest((details, done) => {
    const u = details.url;
    const ok = isEngineUrl(u) || PDF_VIEWER.test(u) || /^(data|blob|about|devtools|chrome-devtools):/i.test(u);
    done({ cancel: !ok });
  });
  reader.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  silenceSpellCheck(reader);
}

/**
 * Where Chromium uses its own spell checker (not on current Windows, which uses the system one) it
 * downloads a dictionary from Google. Turn spell checking off and point the downloader at nothing.
 */
function silenceSpellCheck(ses) {
  try { ses.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/'); } catch { /* not supported on this platform */ }
  try { ses.setSpellCheckerLanguages([]); } catch { /* not supported on this platform */ }
  try { ses.setSpellCheckerEnabled(false); } catch { /* older Electron */ }
}

function lockAppSession() {
  // The app's own pages are local files; they have no business on the network. The one exception is
  // the map, its fonts and its icons, which the map view reads from the app's own local server.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, done) => {
      let ok = false;
      try { const u = new URL(details.url); ok = Boolean(schoolServer) && u.origin === schoolServer.origin && u.pathname.startsWith('/m/'); } catch { ok = false; }
      done({ cancel: !ok });
    },
  );
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // A GPS receiver is a serial port. The app's own window may read serial ports (it never writes to one);
  // the reader, which shows downloaded pages, has a session of its own and gets nothing.
  session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === 'serial');
  session.defaultSession.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    const list = portList.map((p) => ({ id: p.portId, name: p.displayName || p.portName || 'Serial port', port: p.portName || '', vendorId: p.vendorId || '', productId: p.productId || '' }));
    if (win && !win.isDestroyed()) win.webContents.send('gps-ports', list);
    const pick = list.find((p) => p.id === gpsWanted) || (gpsWanted ? null : list[0]);
    gpsWanted = null;
    callback(pick ? pick.id : '');
  });
  silenceSpellCheck(session.defaultSession);
  silenceSpellCheck(session.fromPartition('persist:reader'));
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.spellcheck = false;
    prefs.plugins = true; // the built-in PDF viewer, for the School files
    if (params.src && params.src !== 'about:blank' && !isEngineUrl(params.src)) event.preventDefault();
  });

  if (contents.getType() === 'webview') {
    const outside = (url) => {
      if (!/^https?:/i.test(url)) return;
      followSisterLink(url)
        .then((r) => { if (r !== true) send('external-link', { url, hint: r || null }); })
        .catch(() => send('external-link', { url, hint: null }));
    };
    contents.setWindowOpenHandler(({ url }) => {
      if (isEngineUrl(url)) send('open-url', { url }); else outside(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isEngineUrl(url)) { event.preventDefault(); outside(url); }
    });
    // Keyboard shortcuts still work while the article has focus.
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      const mod = input.control || input.meta;
      let action = null;
      if (mod && key === 'f') action = 'find';
      else if (mod && key === 'k') action = 'search';
      else if (mod && (key === '=' || key === '+')) action = 'zoom-in';
      else if (mod && key === '-') action = 'zoom-out';
      else if (mod && key === '0') action = 'zoom-reset';
      else if (input.alt && key === 'arrowleft') action = 'back';
      else if (input.alt && key === 'arrowright') action = 'forward';
      else if (key === 'escape') action = 'escape';
      if (action) { if (action !== 'escape') event.preventDefault(); send('shortcut', action); }
    });
  } else {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
  }
});

// ---------------------------------------------------------------- window & tray

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 920, minHeight: 600,
    show: false,
    backgroundColor: '#F3F6F8',
    title: 'Wikivault',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });
  win.on('close', (event) => {
    // Closing the window keeps downloads and the daily check running in the tray.
    if (!quitting && settings.keepInTray && tray && settings.dataDir) {
      event.preventDefault();
      win.hide();
      // Nothing needs the model while the window is closed: give its memory back.
      freeModelMemory('window closed', { stopService: true });
      for (const ses of [win.webContents.session, session.fromPartition('persist:reader')]) ses.clearCache().catch(() => {});
    }
  });
  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win) createWindow();
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}

function updateTray() {
  if (!tray) return;
  const s = editions?.snapshot();
  let tip = 'Wikivault';
  if (s?.phase === 'downloading' && s.progress?.total) tip = `Wikivault: downloading, ${Math.floor((100 * s.progress.downloaded) / s.progress.total)}%`;
  else if (s?.phase === 'verifying') tip = 'Wikivault: verifying the new edition';
  else if (s?.phase === 'moving') tip = 'Wikivault: moving the new edition into the library';
  else if (s?.active?.date) tip = `Wikivault: ${s.active.date} edition`;
  tray.setToolTip(tip);
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png')));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Wikivault', click: showWindow },
      { label: 'Check for a newer edition', click: () => editions?.check().then(() => { if (settings.autoUpdate && editions.updateAvailable()) editions.update(); }) },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
    updateTray();
  } catch (err) { log(`tray unavailable: ${err.message}`); tray = null; }
}

function applyLoginItem() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  // Versions before 0.5 registered under Electron's default name; drop that entry so only one exists.
  try { app.setLoginItemSettings({ openAtLogin: false, name: 'electron.app.Wikivault' }); } catch { /* nothing to remove */ }
  app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtLogin && settings.dataDir), args: ['--background'], name: LOGIN_ITEM_NAME });
}

// ---------------------------------------------------------------- setting up answers

/**
 * Everything needed for answers, in one go: install Foundry Local if it is missing (Windows),
 * start it, download the model if it is not on this machine, and load it. Runs when the person
 * agreed to it in the installer, on the first-run screen, or with the button in the Ask panel.
 */
let answerSetup = null;
function setupAnswers() {
  if (answerSetup) return answerSetup;
  answerSetup = (async () => {
    const status = (text) => { aiBusy = text; pushState(); };
    try {
      status('Checking for Foundry Local');
      llm.invalidate();
      try {
        await llm.prepare({ allowDownload: true, onStatus: status });
      } catch (err) {
        if (err.code !== 'NOT_INSTALLED' || process.platform !== 'win32' || settings.ai.provider === 'custom') throw err;
        status('Installing Microsoft Foundry Local');
        await llm.installFoundry((line) => status(`Installing Microsoft Foundry Local: ${line.slice(0, 70)}`));
        // Remembered so the uninstaller can offer to remove it again.
        execFile('reg.exe', ['add', 'HKCU\\Software\\Wikivault', '/v', 'FoundryByWikivault', '/t', 'REG_SZ', '/d', '1', '/f'], { windowsHide: true }, () => {});
        llm.invalidate();
        await llm.prepare({ allowDownload: true, onStatus: status });
      }
      settings.ai.autoSetup = 'done';
      log(`answers ready: ${llm.status().modelId} ${llm.status().device}`);
      return llm.status();
    } catch (err) {
      settings.ai.autoSetup = 'failed';
      log(`answer setup failed: ${err.message}`);
      throw err;
    } finally {
      lastAiUse = Date.now();
      aiBusy = null;
      answerSetup = null;
      saveSettings();
      pushState();
    }
  })();
  return answerSetup;
}

/** Switch answers to one exact build, loading it (and downloading it if need be). */
async function useModel(id) {
  const previous = llm.status().modelId;
  Object.assign(settings.ai, { provider: 'foundry', foundryModel: id, foundryModelId: null, foundryModelFor: null });
  saveSettings();
  const status = await setupAnswers();
  if (previous && previous !== status.modelId) await llm.unload(previous); // free its memory
  return status;
}

/**
 * Time the given builds one after another on this computer and switch to the fastest.
 * Results are kept in the settings so the Library page can show them later.
 */
let speedAbort = null;
async function runSpeedTests({ ids, allowDownload }) {
  if (speedAbort || answerSetup) throw new Error('The model is busy. Try again when it has finished.');
  speedAbort = new AbortController();
  const { signal } = speedAbort;
  const results = [];
  const active = llm.status().modelId;
  try {
    for (const [i, id] of ids.entries()) {
      const label = `Speed test ${i + 1} of ${ids.length}`;
      const status = (text) => { aiBusy = `${label}: ${text}`; pushState(); };
      status(id);
      let r;
      try {
        r = await llm.speedTest({ id, allowDownload, contextChars: settings.ai.contextChars, onStatus: status, signal });
        log(`speed test ${id}: ${r.tokensPerS} tokens/s, first word after ${r.firstS}s, load ${r.loadS ?? '(already loaded)'}s, ${r.contextChars} characters of article text`);
      } catch (err) {
        if (err.name === 'AbortError' || signal.aborted) throw err;
        r = { id, error: err.message, at: new Date().toISOString() };
        log(`speed test ${id} failed: ${err.message}`);
      }
      results.push(r);
      settings.ai.speedTests = { ...(settings.ai.speedTests || {}), [id]: r };
      saveSettings();
    }
    const best = fastest(results);
    const switched = Boolean(best && best.id !== active);
    speedAbort = null;
    if (switched) await useModel(best.id);
    await llm.releaseMemory({ keep: llm.status().modelId || best?.id, also: ourModelIds() });
    // Builds fetched only for this comparison and not chosen are not worth their disk space.
    const cleared = await removeDownloads(results.filter((r) => r.downloaded && r.id !== best?.id).map((r) => r.id));
    return { results, best: best?.id || null, switched, removed: cleared.removed, freedMb: cleared.freedMb };
  } finally {
    speedAbort = null;
    lastAiUse = Date.now();
    aiBusy = null;
    pushState();
  }
}

// ---------------------------------------------------------------- disk space

/**
 * Delete the downloaded files of builds that are not in use, keeping their timings.
 * Returns what was removed and what could not be.
 */
async function removeDownloads(ids) {
  const inUse = String(llm.status().modelId || settings.ai.foundryModelId || '').toLowerCase();
  const out = { removed: [], kept: [], freedMb: 0 };
  for (const id of [...new Set(ids)]) {
    if (id.toLowerCase() === inUse) continue;
    const r = await llm.removeDownload(id).catch((err) => ({ removed: false, reason: err.message }));
    if (r.removed) {
      out.removed.push(id);
      out.freedMb += r.sizeMb || 0;
      const t = settings.ai.speedTests?.[id];
      if (t) settings.ai.speedTests = { ...settings.ai.speedTests, [id]: { ...t, removed: true } };
    } else out.kept.push({ id, reason: r.reason });
  }
  if (out.removed.length) saveSettings();
  return out;
}

// The points a person agrees to before using the app (see build/license.txt). Raise the number
// when the wording changes in a way people should see again.
const TERMS_VERSION = 1;

// ---------------------------------------------------------------- memory

/** Every model build this app has ever loaded, so stale ones from an earlier run are released too. */
function ourModelIds() {
  return [...Object.keys(settings.ai.speedTests || {}), settings.ai.foundryModelId, ...((settings.ai.tuning?.tested || []).map((t) => t.id))].filter(Boolean);
}

/**
 * Take the model out of memory (it loads again with the next question). When the window is
 * closed or the app quits, Foundry Local's background service is stopped as well, unless some
 * other program has a model loaded in it.
 */
let releasing = null;
function freeModelMemory(reason, { stopService = false } = {}) {
  if (releasing) return releasing;
  if (aiBusy || asks.size || speedAbort || answerSetup || settings.ai.provider !== 'foundry') return Promise.resolve(null);
  releasing = llm.releaseMemory({ stopService, also: ourModelIds() }).then((r) => {
    if (r.unloaded.length || r.stopped) {
      aiResting = true;
      log(`memory released (${reason})`);
      pushState();
    }
    return r;
  }).catch((err) => { log(`memory release failed: ${err.message}`); return null; }).finally(() => { releasing = null; });
  return releasing;
}

let staleCheck = true;
function startIdleWatch() {
  setInterval(() => {
    const minutes = Number(settings.ai.idleMinutes);
    if (llm.status().state === 'ready' && !releasing) aiResting = false; // loaded again by a question
    // Something to release: a model loaded in this run, or (checked once) one left by an earlier run.
    if (!minutes || aiResting || !(llm.touched.size || staleCheck)) return;
    if (Date.now() - lastAiUse >= minutes * 60e3) {
      staleCheck = false;
      freeModelMemory(`idle for ${minutes < 1 ? 'under a' : minutes} min`);
    }
  }, Number(process.env.WIKIVAULT_IDLE_TICK_MS) || 20e3).unref();
}

// ---------------------------------------------------------------- tuning for this computer

// What the tuning panel shows while a run is under way: which of the three steps, how far along
// overall, how far along the current action (null when that cannot be known), and the action itself.
let tuneProgress = null;
const TUNE_STEP = {
  1: { text: 'Step 1 of 3: comparing the hardware in this computer', from: 0, share: 0.3 },
  2: { text: 'Step 2 of 3: finding the largest model that writes comfortably', from: 0.3, share: 0.5 },
  3: { text: 'Step 3 of 3: setting the reading budget and answer length', from: 0.8, share: 0.2 },
};
function showTune(step, done, total, detail) {
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(detail);
  const within = pct ? Math.min(1, Number(pct[1]) / 100) : null;
  const s = TUNE_STEP[step];
  // A download is most of an item's time, so it moves the overall bar most of the way through that item.
  const item = /^Downloading|: Downloading/.test(detail) ? (within ?? 0) * 0.8 : /Timing/.test(detail) ? 0.9 : /Loading/.test(detail) ? 0.85 : 0;
  const overall = Math.min(1, s.from + s.share * Math.min(1, (done + item) / Math.max(total, 1)));
  tuneProgress = { step, summary: s.text, overall: Math.max(tuneProgress?.overall || 0, overall), stepFraction: within, detail };
  aiBusy = `Tuning: ${detail}`;
  pushState();
}

const BUDGET_NAME = { 3000: 'Small', 6000: 'Medium', 10000: 'Large', 16000: 'Very large' };
const LENGTH_NAME = { 250: 'Short', 400: 'Medium', 800: 'Long' };
const gbText = (mb) => (mb ? `${(mb / 1024).toFixed(1)} GB` : 'size unknown');
const timedOk = (r) => Boolean(r && !r.error && r.tokensPerS > 0);

async function tunePlan() {
  if (settings.ai.provider !== 'foundry') return { custom: true };
  const ramMb = os.totalmem() / 1048576;
  const families = tune.eligible(await llm.listFoundryModels(), { ramMb });
  if (!families.length) throw new Error('Foundry Local has not listed any models yet. Set up answers first, then tune.');
  const tests = settings.ai.speedTests || {};
  const probe = tune.pickProbe(families, tests);
  const probeMb = probe ? probe.builds.filter((b) => !b.cached && !timedOk(tests[b.id])).reduce((sum, b) => sum + (b.sizeMb || 0), 0) : 0;
  const sizes = families.flatMap((f) => f.builds.map((b) => b.sizeMb)).filter(Boolean);
  return { devices: tune.devicesOf(families), families: families.length, probe: probe?.family.alias || null, probeMb, smallestMb: Math.min(...sizes), largestMb: Math.max(...sizes), ramGb: Math.round(ramMb / 1024) };
}

/**
 * Measure this computer and set answers up for it: which hardware is fastest, which model is the
 * largest that still writes comfortably there, and how much article text and answer length suit
 * that speed. Every choice comes from a timing taken here and can be changed afterwards.
 */
async function tuneRun() {
  if (speedAbort || answerSetup) throw new Error('The model is busy. Try again when it has finished.');
  speedAbort = new AbortController();
  const { signal } = speedAbort;
  tuneProgress = null;
  const prefs = tune.profile(settings.ai.tunePreference);
  const reasons = [`Preference: ${prefs.name}. Aims for at least ${prefs.targetTps} tokens a second, the first word within about ${prefs.firstWordS} s, and a full answer within about ${prefs.writeS} s.`];
  const tested = [];
  const attempted = new Set(); // every build this run loaded or tried to, so nothing it fetched is left behind
  const record = (r) => { settings.ai.speedTests = { ...(settings.ai.speedTests || {}), [r.id]: r }; saveSettings(); };
  const time = async (id, contextChars, label, [step, done, total]) => {
    attempted.add(id);
    showTune(step, done, total, label);
    try {
      const r = await llm.speedTest({ id, allowDownload: true, contextChars, onStatus: (t) => showTune(step, done, total, t), signal });
      log(`tuning: ${id} at ${contextChars} characters: ${r.tokensPerS} tokens/s, first word after ${r.firstS}s`);
      return r;
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted) throw err;
      log(`tuning: ${id} could not be timed: ${err.message}`);
      return { id, error: err.message, contextChars, at: new Date().toISOString() };
    }
  };
  try {
    let rec;
    let chosen = null;
    let device = null;
    if (settings.ai.provider !== 'foundry') {
      showTune(3, 0, 2, 'Timing your model server with a small reading budget');
      const small = await llm.speedTestCustom({ contextChars: 3000, signal });
      showTune(3, 1, 2, 'Timing it again with a large reading budget');
      const large = await llm.speedTestCustom({ contextChars: 10000, signal }).catch(() => null);
      rec = tune.recommendSettings(small, large, prefs);
      chosen = { id: small.id, alias: small.id };
      reasons.push(`Your model server writes ${small.tokensPerS} tokens a second with a small reading budget${large ? ` and ${large.tokensPerS} with a large one` : ''}.`);
    } else {
      const families = tune.eligible(await llm.listFoundryModels(), { ramMb: os.totalmem() / 1048576 });
      if (!families.length) throw new Error('Foundry Local has not listed any models yet. Set up answers first, then tune.');
      const tests = { ...(settings.ai.speedTests || {}) };
      const usable = (r) => timedOk(r) && r.contextChars === 3000;

      // 1. Which hardware is fastest, compared on one model that has a build for each.
      device = tune.devicesOf(families)[0];
      let known = null;
      const probe = tune.pickProbe(families, tests);
      if (probe) {
        const results = [];
        for (const [n, b] of probe.builds.entries()) {
          let r = tests[b.id];
          showTune(1, n, probe.builds.length, `Checking the ${b.device} with ${probe.family.alias}`);
          if (!usable(r)) { r = await time(b.id, 3000, `Checking the ${b.device} with ${probe.family.alias}`, [1, n, probe.builds.length]); record(r); tests[b.id] = r; }
          results.push({ ...r, device: b.device, sizeMb: b.sizeMb });
        }
        const best = fastest(results);
        if (best) { device = best.device; known = { tokensPerS: best.tokensPerS, sizeMb: best.sizeMb }; }
        reasons.push(`Hardware, compared on ${probe.family.alias}: ${results.map((r) => `${r.device} ${r.error ? 'could not be timed' : `${r.tokensPerS} tokens a second`}`).join(', ')}.${best ? ` The ${device} is fastest.` : ''}`);
      } else {
        reasons.push(`Foundry Local offers models for one kind of hardware on this computer (${device}), so there was nothing to compare.`);
      }

      // 2. The largest model that still writes comfortably on that hardware.
      const rungs = tune.ladder(families, device);
      // A timing already taken on this hardware predicts other sizes better than the small comparison model does.
      const prior = rungs.map((r) => ({ r, t: tests[r.build.id] })).filter((x) => usable(x.t)).sort((a, b) => (b.r.build.sizeMb || 0) - (a.r.build.sizeMb || 0))[0];
      if (prior) known = { tokensPerS: prior.t.tokensPerS, sizeMb: prior.r.build.sizeMb };
      const measured = new Map();
      const details = new Map();
      const goal = { known, target: prefs.targetTps };
      for (let i = tune.nextRung(rungs, measured, goal); i != null; i = tune.nextRung(rungs, measured, goal)) {
        const b = rungs[i].build;
        let r = tests[b.id];
        showTune(2, measured.size, 3, `Trying ${rungs[i].alias} on the ${device}`);
        // A build that would not run here recently is not downloaded again just to fail again.
        const failedRecently = r?.error && Date.now() - Date.parse(r.at || 0) < 30 * 86400e3;
        if (failedRecently) {
          measured.set(i, 0);
          tested.push({ id: b.id, alias: rungs[i].alias, sizeMb: b.sizeMb, tokensPerS: 0, firstS: null, error: r.error });
          continue;
        }
        if (!usable(r)) { r = await time(b.id, 3000, `Trying ${rungs[i].alias} on the ${device}`, [2, measured.size, 3]); record(r); tests[b.id] = r; }
        measured.set(i, timedOk(r) ? r.tokensPerS : 0);
        details.set(i, r);
        tested.push({ id: b.id, alias: rungs[i].alias, sizeMb: b.sizeMb, tokensPerS: timedOk(r) ? r.tokensPerS : 0, firstS: r.firstS ?? null, error: r.error || null });
      }
      const pick = tune.choose(rungs, measured, prefs.targetTps);
      if (!pick) throw new Error(`None of the models could be timed. ${tested.at(-1)?.error || ''}`.trim());
      tested.sort((a, b) => (a.sizeMb || 0) - (b.sizeMb || 0));
      reasons.push(`Models tried on the ${device}: ${tested.map((t) => `${t.alias} (${gbText(t.sizeMb)}) ${t.error ? 'could not be timed' : `${t.tokensPerS} tokens a second`}`).join('; ')}.`);
      reasons.push(pick.meetsTarget
        ? `Chosen: ${pick.alias}. It is the largest that writes at ${prefs.targetTps} tokens a second or more here, and larger models give better answers.`
        : `Chosen: ${pick.alias}, the fastest available. Nothing reached ${prefs.targetTps} tokens a second on this computer.`);
      chosen = { id: pick.build.id, alias: pick.alias };
      showTune(3, 0, 3, `Switching to ${pick.alias}`);
      await useModel(pick.build.id);

      // 3. How much article text and answer length suit that speed.
      const large = await time(pick.build.id, 10000, `Timing ${pick.alias} with a large reading budget`, [3, 1, 3]);
      showTune(3, 2, 3, 'Freeing memory and deleting downloads that were only needed for testing');
      rec = tune.recommendSettings(details.get(pick.index), timedOk(large) ? large : null, prefs);
      await llm.releaseMemory({ keep: llm.status().modelId || pick.build.id, also: [...ourModelIds(), ...tested.map((t) => t.id)] });
      // Only the chosen model is worth its disk space. Every other download this app has made, in
      // this run or before it, is deleted; the timings are kept. Models the app never used are not touched.
      const downloaded = (await llm.listFoundryModels()).flatMap((f) => f.builds).filter((b) => b.cached).map((b) => b.id.toLowerCase());
      const mine = [...new Set([...ourModelIds(), ...attempted])].filter((id) => id !== pick.build.id && downloaded.includes(id.toLowerCase()));
      const cleared = await removeDownloads(mine);
      if (cleared.removed.length) reasons.push(`Deleted every other model download (${gbText(cleared.freedMb)} freed): ${cleared.removed.join(', ')}. Their timings are kept.`);
      if (cleared.kept.length) reasons.push(`Could not delete: ${cleared.kept.map((k) => `${k.id} (${k.reason})`).join('; ')}`);
    }
    settings.ai.contextChars = rec.contextChars;
    settings.ai.maxAnswerTokens = rec.maxAnswerTokens;
    reasons.push(`Reading budget: ${BUDGET_NAME[rec.contextChars]}. With that much article text the first word comes after about ${rec.firstS} s and writing runs at ${rec.tokensPerS} tokens a second.`);
    reasons.push(`Answer length: ${LENGTH_NAME[rec.maxAnswerTokens]}, about ${rec.writeS} s to write in full.`);
    settings.ai.tuning = { at: new Date().toISOString(), preference: Math.min(4, Math.max(0, Math.round(Number(settings.ai.tunePreference ?? 2)))), device, chosen: chosen.id, alias: chosen.alias, tested, contextChars: rec.contextChars, maxAnswerTokens: rec.maxAnswerTokens, reasons };
    saveSettings();
    log(`tuning done: ${chosen.id}, reading budget ${rec.contextChars}, answer length ${rec.maxAnswerTokens}`);
    return settings.ai.tuning;
  } finally {
    speedAbort = null;
    tuneProgress = null;
    lastAiUse = Date.now();
    aiBusy = null;
    pushState();
  }
}

/** The installer leaves a note in the registry when the person chose to have answers set up. */
function readInstallerChoice() {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Wikivault', '/v', 'SetupAnswers'], { windowsHide: true }, (err, out) => {
      if (!err && /SetupAnswers\s+REG_SZ\s+1\b/.test(String(out))) {
        settings.ai.autoSetup = 'pending';
        saveSettings();
        execFile('reg.exe', ['add', 'HKCU\\Software\\Wikivault', '/v', 'SetupAnswers', '/t', 'REG_SZ', '/d', 'started', '/f'], { windowsHide: true }, () => resolve());
      } else resolve();
    });
  });
}

// ---------------------------------------------------------------- moving the library, returning the partition

const isBusy = () => ['checking', 'downloading', 'verifying', 'switching', 'moving'].includes(editions?.snapshot().phase);

/** True when the library folder sits on the partition the app created. */
function libraryOnPartition() {
  const p = settings.partition;
  if (!p || !settings.dataDir) return false;
  return path.resolve(settings.dataDir).toLowerCase().startsWith(path.resolve(p.root).toLowerCase());
}

/**
 * A partition made by a version that did not record it (0.4.x) is recognised by
 * where the library lives and by the volume's name.
 */
async function detectPartition() {
  if (settings.partition || !settings.dataDir || !partitionAvailable()) return;
  try {
    if (partitionSim) {
      const sim = JSON.parse(fs.readFileSync(partitionSim, 'utf8'));
      if (sim.lastCreate && !sim.merged && path.resolve(settings.dataDir).startsWith(path.resolve(sim.mountAt))) {
        settings.partition = { driveLetter: 'W', sourceLetter: systemLetter(), sizeBytes: sim.lastCreate.sizeBytes, root: sim.mountAt };
      }
    } else {
      const m = /^([A-Za-z]):\\Wikivault$/.exec(settings.dataDir);
      const letter = m && m[1].toUpperCase();
      if (!letter || letter === systemLetter()) return;
      let seen = null;
      try { seen = await partitionTool.inspect(systemLetter(), letter); } catch (err) { log(`partition detection: could not inspect ${letter}: (${err.message})`); }
      if (seen ? (seen.exists && seen.label === 'Wikivault') : fs.existsSync(`${letter}:\\`)) {
        // If Windows would not describe the drive without administrator rights, go by where the
        // library lives. The merge script checks the drive's name, position and contents itself
        // before it removes anything, so a wrong guess here cannot cost data.
        let sizeBytes = seen?.otherSize;
        if (!sizeBytes) {
          try { const st = await fsp.statfs(`${letter}:\\`); sizeBytes = Number(st.blocks) * Number(st.bsize); } catch { sizeBytes = 0; }
        }
        settings.partition = { driveLetter: letter, sourceLetter: systemLetter(), sizeBytes, root: `${letter}:\\` };
      }
    }
    if (settings.partition) { saveSettings(); log(`recognised the Wikivault partition ${settings.partition.driveLetter}:`); pushState(); }
  } catch (err) { log(`partition detection: ${err.message}`); }
}

function setMaintenance(patch) {
  maintenance = patch ? { ...(maintenance || {}), ...patch } : null;
  pushState();
}

/**
 * Move the library to another folder: copy, verify, switch the app over, and
 * only then remove the old copy. If anything fails before the switch, the
 * library stays where it was.
 */
async function moveLibrary(toDir, kind = 'move') {
  if (!editions?.snapshot().active) throw new Error('There is no edition to move yet.');
  if (isBusy()) throw new Error('An update is in progress. Pause or finish it, then try again.');
  const oldDir = settings.dataDir;
  const oldStaging = settings.stagingDir;
  const busyExtra = [...extras].find(([, x]) => ['checking', 'downloading', 'verifying', 'switching'].includes(x.manager.snapshot().phase));
  if (busyExtra) throw new Error(`${LIBRARIES[busyExtra[0]].name} is being downloaded. Let it finish or cancel it under More libraries, then try again.`);
  // Wikibooks and Wikiversity go wherever Wikipedia goes.
  const carried = [...extras].filter(([, x]) => x.manager.snapshot().active).map(([id, x]) => ({ id, x, name: LIBRARIES[id].name, bytes: x.manager.snapshot().active.bytes }));
  if (school?.status().job) throw new Error('The school files are being downloaded or read. Let that finish or cancel it under School, then try again.');
  if (maps?.status().job) throw new Error('The map or its places are being downloaded. Let that finish or stop it under Map, then try again.');
  const oldSchool = path.join(oldDir, 'school');
  const hasSchool = fs.existsSync(oldSchool);
  const oldMaps = path.join(oldDir, 'maps');
  const hasMaps = fs.existsSync(oldMaps);
  const allBytes = editions.snapshot().active.bytes + carried.reduce((n, c) => n + c.bytes, 0) + schoolBytes() + mapsBytes();
  const room = await freeAt(toDir);
  const already = fs.existsSync(path.join(toDir, 'zim')) ? (await fsp.readdir(path.join(toDir, 'zim')).catch(() => [])).some((n) => n.endsWith('.copying')) : false;
  if (room != null && !already && room < allBytes + 2 * 2 ** 30) {
    throw new Error(`The libraries take ${(allBytes / 2 ** 30).toFixed(0)} GB together and that drive has ${(room / 2 ** 30).toFixed(0)} GB free. Choose a folder on a drive with more room.`);
  }
  editions.stopSchedule();
  for (const x of extras.values()) x.manager.stopSchedule();
  try {
    if (editions.snapshot().pending) await editions.cancel(); // a partial download is not worth carrying over
    for (const x of extras.values()) if (x.manager.snapshot().pending) await x.manager.cancel();
    // The small ones first: if one of them cannot be copied, nothing large has been done yet.
    for (const c of carried) {
      const dest = path.join(toDir, 'more', c.id);
      await removeLibraryFiles(dest).catch(() => {}); // left over from an attempt that did not finish
      setMaintenance({ kind, step: `Copying ${c.name}`, done: 0, total: c.bytes, error: null });
      try {
        await copyLibrary({
          manager: c.x.manager, toDir: dest,
          onProgress: (p) => setMaintenance({ step: p.stage === 'copy' ? `Copying ${c.name}` : `Checking the copy of ${c.name} against the checksum`, done: p.done, total: p.total }),
        });
      } catch (err) {
        for (const d of carried) await removeLibraryFiles(path.join(toDir, 'more', d.id)).catch(() => {});
        await fsp.rmdir(path.join(toDir, 'more')).catch(() => {});
        throw new Error(`${c.name}: ${err.message}`);
      }
    }
    if (hasSchool) {
      // The school files and their index are plain files: copied whole, removed from the old place after the switch.
      setMaintenance({ kind, step: 'Copying the school files', done: null, total: null, error: null });
      try { await fsp.cp(oldSchool, path.join(toDir, 'school'), { recursive: true, force: true }); } catch (err) {
        await fsp.rm(path.join(toDir, 'school'), { recursive: true, force: true }).catch(() => {});
        throw new Error(`School files: ${err.message}`);
      }
    }
    if (hasMaps) {
      setMaintenance({ kind, step: 'Copying the map and its places', done: null, total: null, error: null });
      try { await fsp.cp(oldMaps, path.join(toDir, 'maps'), { recursive: true, force: true }); } catch (err) {
        await fsp.rm(path.join(toDir, 'maps'), { recursive: true, force: true }).catch(() => {});
        throw new Error(`Map files: ${err.message}`);
      }
    }
    setMaintenance({ kind, step: 'Copying Wikipedia', done: 0, total: editions.snapshot().active.bytes, error: null });
    const res = await copyLibrary({
      manager: editions, toDir,
      onProgress: (p) => setMaintenance({ step: p.stage === 'copy' ? 'Copying Wikipedia' : 'Checking the copy of Wikipedia against the checksum', done: p.done, total: p.total }),
    });

    setMaintenance({ step: 'Switching to the new location', done: null });
    settings.dataDir = toDir;
    // Staged updates only make sense while the library lives on the small partition.
    settings.stagingDir = libraryOnPartition() ? oldStaging : null;
    saveSettings();
    await initLibrary();
    const lost = carried.filter((c) => !extras.get(c.id)?.engine?.running).map((c) => c.name);
    if (!engine?.running || editions.snapshot().active?.path !== res.activePath || lost.length) {
      settings.dataDir = oldDir;
      settings.stagingDir = oldStaging;
      saveSettings();
      await initLibrary();
      throw new Error(`The copy was made and verified, but the reader could not open ${lost.length ? lost.join(' and ') : 'it'} from the new folder. The library is still in its original place.`);
    }

    setMaintenance({ step: 'Removing the old copy', done: null });
    if (hasSchool) await fsp.rm(oldSchool, { recursive: true, force: true }).catch((err) => log(`old school folder: ${err.message}`));
    // The routing engine was told to stop a moment ago and may still hold its files; a few tries give it time to let go.
    if (hasMaps) await fsp.rm(oldMaps, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }).catch((err) => log(`old maps folder: ${err.message}`));
    for (const id of Object.keys(LIBRARIES)) await removeLibraryFiles(path.join(oldDir, 'more', id), { log });
    await fsp.rmdir(path.join(oldDir, 'more')).catch(() => {});
    await removeLibraryFiles(oldDir, { log });
    if (oldStaging && !settings.stagingDir) {
      for (const name of await fsp.readdir(oldStaging).catch(() => [])) {
        if (/\.(zim|part)$/i.test(name)) await fsp.rm(path.join(oldStaging, name), { force: true }).catch(() => {});
      }
      await fsp.rmdir(oldStaging).catch(() => {});
    }
    log(`library moved from ${oldDir} to ${toDir}`);
    return { dataDir: toDir };
  } finally {
    editions?.startSchedule();
    for (const x of extras.values()) x.manager.startSchedule();
  }
}

/** Look at the partition and say whether it can be merged back right now. */
async function partitionStatus() {
  const p = settings.partition;
  if (!p) return { exists: false };
  const seen = await partitionTool.inspect(p.sourceLetter || systemLetter(), p.driveLetter);
  return { ...seen, libraryOnPartition: libraryOnPartition() };
}

/**
 * Stop using the dedicated partition: move the library off it if it is still
 * there, then remove the partition and give its space back to the Windows drive.
 */
async function revertPartition({ toDir, allowBattery }) {
  const p = settings.partition;
  if (!p) throw new Error('Wikivault has no partition to remove.');
  if (onBattery() && !allowBattery) throw new Error('The laptop is on battery power. Plug in the charger, or confirm that you want to continue on battery.');
  try {
    if (libraryOnPartition()) {
      if (editions?.snapshot().active) await moveLibrary(toDir || defaultDataDir(), 'revert');
      else {
        // Nothing downloaded yet: just stop pointing at the partition.
        setMaintenance({ kind: 'revert', step: 'Switching to a folder', done: null, error: null });
        if (editions?.snapshot().pending) await editions.cancel();
        const oldDir = settings.dataDir;
        settings.dataDir = toDir || defaultDataDir();
        settings.stagingDir = null;
        await fsp.mkdir(settings.dataDir, { recursive: true });
        saveSettings();
        await initLibrary();
        await removeLibraryFiles(oldDir, { log });
      }
    }
    setMaintenance({ kind: 'revert', step: `Removing drive ${p.driveLetter}: and returning its space to ${p.sourceLetter}:`, done: null, error: null });
    const r = await partitionTool.merge(p.sourceLetter || systemLetter(), p.driveLetter);
    settings.partition = null;
    settings.stagingDir = null;
    saveSettings();
    setMaintenance(null);
    return { merged: true, extended: r.extended, warning: r.warning || null, sourceLetter: r.sourceLetter, sourceSizeAfter: r.sourceSizeAfter, removedLetter: r.removedLetter };
  } catch (err) {
    log(`revert partition: ${err.code || 'ERROR'} ${err.message}`);
    setMaintenance({ kind: 'revert', step: null, done: null, error: err.message });
    throw err;
  }
}

/**
 * Give the library a partition of its own, or change the size of the one it has (see partitionPlan).
 * Each step leaves the library whole and in use: if a later step fails, the library is where the last
 * finished step put it, and the message says where.
 */
async function changePartition({ sizeBytes, staged, allowBattery }) {
  if (onBattery() && !allowBattery) throw new Error('The laptop is on battery power. Plug in the charger, or confirm that you want to continue on battery.');
  const plan = await partitionPlan();
  if (plan.mode === 'blocked') throw new Error(`Drive ${plan.current.driveLetter}: exists but the library is not on it. Move the library onto it, or remove the drive, and then choose a size.`);
  const chosen = staged ? plan.plans.staged : plan.plans.selfContained;
  if (!chosen.feasible) throw new Error(chosen.reason);
  const bytes = Math.floor(Number(sizeBytes) / GB) * GB;
  if (!(bytes >= chosen.minBytes && bytes <= chosen.maxBytes)) throw new Error(`Choose a size between ${chosen.minBytes / GB} and ${chosen.maxBytes / GB} GB.`);
  if (plan.mode === 'resize' && bytes === plan.current.sizeBytes && staged === plan.staged) throw new Error('That is the size the partition has now.');
  if (!plan.tempOk) throw new Error(`Changing the size means keeping the library on ${plan.source}: for a while, which needs ${Math.ceil(plan.tempNeeded / GB)} GB free there. There is ${Math.floor(plan.tempFree / GB)} GB. Free up space on ${plan.source}:, or remove part of the library, and try again.`);
  let at = 'start';
  try {
    if (plan.mode === 'resize') await revertPartition({ toDir: plan.tempDir, allowBattery: true });
    at = 'create';
    setMaintenance({ kind: 'partition', step: `Creating a ${bytes / GB} GB partition. Windows asks for administrator approval`, done: null, total: null, error: null });
    let r; let adjusted = false;
    try { r = await partitionTool.create(plan.source, bytes, 'Wikivault'); } catch (err) {
      // Windows found less room than it reported beforehand: take what it can give, if that is still enough.
      const most = err.code === 'TOO_LARGE' && err.maxBytes ? Math.floor(err.maxBytes / GB) * GB : 0;
      if (most < chosen.minBytes) throw err;
      adjusted = true;
      setMaintenance({ step: `Windows can free ${most / GB} GB right now. Creating a partition of that size. It asks for approval again` });
      r = await partitionTool.create(plan.source, most, 'Wikivault');
    }
    const dataDir = r.mountAt ? path.join(r.mountAt, 'Wikivault') : `${r.driveLetter}:\\Wikivault`;
    settings.partition = { driveLetter: r.driveLetter, sourceLetter: plan.source, sizeBytes: r.sizeBytes, root: r.mountAt || `${r.driveLetter}:\\` };
    settings.stagingDir = staged ? defaultStagingDir() : null; // taken up by the move once the library is on the partition
    saveSettings();
    log(`partition: created ${r.driveLetter}: at ${Math.round(r.sizeBytes / GB)} GB for the library`);
    at = 'move';
    await moveLibrary(dataDir, 'partition');
    setMaintenance(null);
    return { driveLetter: r.driveLetter, sizeBytes: r.sizeBytes, dataDir, adjusted, was: plan.current ? plan.current.sizeBytes : null };
  } catch (err) {
    if (at !== 'start' && !libraryOnPartition() && settings.stagingDir) { settings.stagingDir = null; saveSettings(); }
    const tail = at === 'create' ? ` The library is whole and in use in ${settings.dataDir}. Nothing else was changed, and you can choose a size again.`
      : at === 'move' ? ` The new drive was made, and the library is still whole and in use in ${settings.dataDir}. From the Library page you can move it onto the drive or remove the drive.` : '';
    const message = `${err.message}${tail}`;
    log(`change partition (${at}): ${err.code || 'ERROR'} ${err.message}`);
    setMaintenance({ kind: 'partition', step: null, done: null, error: message });
    throw new Error(message);
  }
}

// ---------------------------------------------------------------- the address book and contacts accounts

let book = null;
/** Where the places are wanted first: where you are, else the place pinned as home. */
function placesNear(a) {
  const ok = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
  if (a && ok(a.near)) return { lat: a.near.lat, lon: a.near.lon };
  const home = book ? book.pinned('home').find(ok) : null;
  return home ? { lat: home.lat, lon: home.lon } : null;
}
let bookBusy = null; // what the book is doing with an account, in words, or null
let gpsWanted = null; // the serial port the window asked to open next

const secretsFile = () => path.join(app.getPath('userData'), 'accounts.json');
// Sign-ins for the contacts accounts. On disk each is encrypted by Windows for this user of this computer;
// in memory they are kept as read, so that asking which accounts exist costs nothing.
let secrets = {};
// The tests run where there is no keyring to encrypt with, and say so; nothing else may store a sign-in unsealed.
const testSeal = () => Boolean(process.env.WIKIVAULT_TEST_SEAL);
const canSeal = async () => testSeal() || safeStorage.isAsyncEncryptionAvailable().catch(() => false);
async function loadSecrets() {
  secrets = {};
  let j = null;
  try { j = JSON.parse(await fsp.readFile(secretsFile(), 'utf8')); } catch { return; }
  for (const [k, v] of Object.entries(j)) {
    try {
      const buf = Buffer.from(v, 'base64');
      const text = testSeal() ? Buffer.from(buf.toString('latin1').split('').reverse().join(''), 'latin1').toString('utf8') : (await safeStorage.decryptStringAsync(buf)).result;
      secrets[k] = JSON.parse(text);
    } catch { /* sealed on another computer or by another user: of no use here */ }
  }
}
const readSecrets = () => secrets;
async function writeSecrets(all) {
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    const text = JSON.stringify(v);
    const buf = testSeal() ? Buffer.from(Buffer.from(text, 'utf8').toString('latin1').split('').reverse().join(''), 'latin1') : await safeStorage.encryptStringAsync(text);
    out[k] = buf.toString('base64');
  }
  await fsp.mkdir(app.getPath('userData'), { recursive: true });
  await fsp.writeFile(secretsFile(), JSON.stringify(out));
  secrets = { ...all };
}

// Tests read contacts from a stand-in server, and its "browser" is a plain request.
const contactsBase = () => process.env.WIKIVAULT_CONTACTS_BASE || null;
const googleEndpoints = () => (contactsBase() ? { ...contactsSync.GOOGLE, auth: `${contactsBase()}/auth`, token: `${contactsBase()}/token`, people: `${contactsBase()}/people` } : contactsSync.GOOGLE);
const openSignIn = (url) => (contactsBase() ? fetch(url).then(() => true) : shell.openExternal(url));

function initBook() {
  const locate = (address) => {
    if (!maps) return null;
    try { return maps.locateAddress(address); } catch { return null; }
  };
  book = new AddressBook(path.join(app.getPath('userData'), 'addressbook.json'), { locate, log }).load();
  loadSecrets().then(() => pushState()).catch(() => {});
}

function bookState() {
  if (!book) return null;
  const s = readSecrets();
  return { ...book.summary(), busy: bookBusy, everyHours: settings.contacts.everyHours, lookup: settings.contacts.lookup, lookupLast: lookupLast, accounts: { google: Boolean(s.google), googleBy: s.google ? (s.google.refreshToken ? 'sign-in' : 'app password') : null, googleUser: s.google && s.google.user ? s.google.user : null, icloud: s.icloud ? s.icloud.user : null }, addressData: Boolean(maps && maps.status().addresses) };
}
/**
 * Look up online the addresses the downloaded data could not place, when the user has agreed to that. Street
 * addresses only are sent, to the United States Census Bureau, as the body of one request. Nothing about the
 * addresses is written to the log. `loud` makes a failure an error for the caller; otherwise it waits for next time.
 */
let lookupLast = null; // { date, asked, placed } or { date, error }: how the last lookup went, for the page
let lookupRunning = false;
async function lookupAddresses(loud = false) {
  if (!book || settings.contacts.lookup !== true || lookupRunning) return null;
  const asked = book.toLookUp();
  if (!asked.length) return { asked: 0, placed: 0 };
  lookupRunning = true;
  if (!bookBusy) bookBusy = `Looking up ${asked.length === 1 ? 'one address' : `${asked.length} addresses`} online`; pushState();
  try {
    const post = async (url, body, headers, signal) => {
      const { res } = await openRequest(url, { method: 'POST', body, signal, timeoutMs: 120000, headers: { ...headers, 'Content-Length': String(body.length) } });
      if (res.statusCode !== 200) { res.resume(); throw new Error(`The lookup service answered ${res.statusCode}.`); }
      return (await readBody(res, 8 * 1024 * 1024)).toString('utf8');
    };
    const { found } = await geocode.lookup(asked, { post, url: process.env.WIKIVAULT_GEOCODE_URL || geocode.URL_BATCH });
    const r = book.applyLookup(asked, found);
    lookupLast = { date: new Date().toISOString(), ...r };
    log(`address book: ${r.asked} address${r.asked === 1 ? '' : 'es'} looked up online, ${r.placed} placed`);
    return r;
  } catch (err) {
    lookupLast = { date: new Date().toISOString(), error: err.message };
    log(`address book: the online lookup did not work: ${err.message}`);
    if (loud) throw new Error(`The addresses could not be looked up: ${err.message} Nothing was changed, and it is tried again later.`);
    return null;
  } finally { lookupRunning = false; if (bookBusy && bookBusy.startsWith('Looking up')) bookBusy = null; pushState(); }
}

/** Read one account's contacts into the book. `loud` makes a failure an error for the caller; otherwise it is noted in the book. */
async function syncContacts(source, loud = false) {
  const name = source.startsWith('google') ? 'Google' : 'iCloud';
  const s = readSecrets()[source];
  if (!s) throw new Error(`No ${name} account is connected.`);
  const into = source.replace(/Trial$/, '');
  bookBusy = `Reading your contacts from ${name}`; pushState();
  try {
    const google = source === 'google' || source === 'googleTrial';
    const contacts = google && s.refreshToken ? await contactsSync.googleContacts({ ...s, endpoints: googleEndpoints() })
      : google ? await contactsSync.googleByPassword({ ...s, ...(contactsBase() ? { book: `${contactsBase()}/dav/home/card/` } : {}) })
      : await contactsSync.icloudContacts({ ...s, ...(contactsBase() ? { base: `${contactsBase()}/dav/` } : {}) });
    const out = book.importContacts(contacts, into, s.user ? { account: s.user } : {});
    log(`contacts: ${name}: ${out.contacts} contacts, ${out.entries} entries, ${out.located} placed`);
    setTimeout(() => lookupAddresses().catch(() => {}), 50); // once this reading is over
    return out;
  } catch (err) {
    log(`contacts: ${name}: ${err.message}`);
    if (!source.endsWith('Trial')) book.noteError(into, err.code === 'SIGN_IN_AGAIN' ? `${err.message}` : `Could not be read: ${err.message} The contacts already in the book are kept.`);
    if (loud) throw err;
    return null;
  } finally { bookBusy = null; pushState(); }
}

/** Read the accounts again when it has been long enough. Runs at start and every hour; quiet when there is no connection. */
async function contactsDue() {
  if (!book || bookBusy) return;
  const every = settings.contacts.everyHours * 3600 * 1000;
  for (const source of ['google', 'icloud']) {
    if (!readSecrets()[source]) continue;
    const src = book.sources[source] || {};
    const last = Math.max(Date.parse(src.date || 0) || 0, Date.parse(src.tried || 0) || 0);
    if (Date.now() - last >= every) await syncContacts(source).catch(() => {});
  }
}

/** Address-book entries as search results for the map. Only those with a position can be shown or driven to. */
function bookHits(q) {
  if (!book) return [];
  return book.search(q, 6).filter((e) => e.lat != null).map((e) => ({
    c: 'saved', i: `bk${e.id}`, a: e.lat, o: e.lon, n: e.label ? `${e.name} (${e.label})` : e.name, d: String(e.address || '').replace(/\s*\n\s*/g, ', '), p: e.phones || '', kind: [e.pin ? `Pinned as ${e.pinName || relations.pinName(e.pin)}` : 'Saved', e.tie || relations.groupName(e.group)].filter(Boolean).join(', '),
    how: e.how, approx: Boolean(e.how && e.how !== 'exact' && e.how !== 'manual' && e.how !== 'online'), why: e.why || '',
  }));
}

// ---------------------------------------------------------------- IPC

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, arg) => {
    try { return { ok: true, value: await fn(arg || {}) }; } catch (err) {
      log(`${channel}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });
}

function registerIpc() {
  let uiSeen = false;
  handle('state:get', () => { if (!uiSeen) { uiSeen = true; log('window ready'); } return getState(); });

  handle('setup:choose-dir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where should Wikipedia be stored?', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = path.join(r.filePaths[0], 'Wikivault');
    return { dir, freeBytes: await freeBytes(r.filePaths[0]) };
  });

  handle('setup:begin', async ({ dataDir, stagingDir, autoUpdate, launchAtLogin, setupAnswers: wantAnswers, flavour }) => {
    if (FLAVOURS.some((f) => f.flavour === flavour) && flavour !== settings.flavour) { settings.flavour = flavour; editionSizeCache = null; }
    if (wantAnswers && settings.ai.autoSetup !== 'done') {
      settings.ai.autoSetup = 'pending';
      setupAnswers().catch(() => {}); // runs alongside the Wikipedia download; progress shows in Library and Ask
    }
    settings.dataDir = dataDir || defaultDataDir();
    settings.stagingDir = stagingDir || null;
    if (typeof autoUpdate === 'boolean') settings.autoUpdate = autoUpdate;
    if (typeof launchAtLogin === 'boolean') { settings.launchAtLogin = launchAtLogin; settings.keepInTray = launchAtLogin; }
    await fsp.mkdir(settings.dataDir, { recursive: true });
    saveSettings();
    applyLoginItem();
    await initLibrary();
    // The engine is needed to trial-open the download, so fetch it first and fail early if that is not possible.
    await ensureEngineBinary();
    editions.update();
    return true;
  });

  handle('setup:use-file', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a .zim file', properties: ['openFile'], filters: [{ name: 'ZIM archives', extensions: ['zim'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    if (!settings.dataDir) { settings.dataDir = defaultDataDir(); saveSettings(); }
    if (!editions) await initLibrary();
    await editions.useLocalFile(r.filePaths[0]);
    applyLoginItem();
    return true;
  });

  handle('partition:info', async () => {
    if (!partitionAvailable()) throw new Error('Creating a partition is only available on Windows.');
    return partitionInfo();
  });

  // Returns { created: true, ... } or { created: false, code, error, maxBytes } so the UI can react to a too-large request.
  handle('partition:create', async ({ sizeBytes, staged, allowBattery }) => {
    if (!partitionAvailable()) throw new Error('Creating a partition is only available on Windows.');
    const snap = editions?.snapshot();
    if (snap?.active || ['downloading', 'verifying', 'switching', 'moving'].includes(snap?.phase)) {
      throw new Error('A library is already set up. A partition can only be created before the first download.');
    }
    // On battery the person has to say so explicitly in the confirmation; it is their call, not a hard stop.
    if (onBattery() && !allowBattery) throw new Error('The laptop is on battery power. Plug in the charger, or confirm that you want to continue on battery.');
    const info = await partitionInfo();
    const bytes = Math.floor(Number(sizeBytes) / GB) * GB;
    const plan = staged ? info.plans.staged : info.plans.selfContained;
    if (!plan.feasible) throw new Error(plan.reason);
    if (!(bytes >= plan.minBytes && bytes <= plan.maxBytes)) {
      throw new Error(`Choose a size between ${plan.minBytes / GB} and ${plan.maxBytes / GB} GB.`);
    }
    try {
      const r = await partitionTool.create(info.driveLetter, bytes, 'Wikivault');
      const dataDir = r.mountAt ? path.join(r.mountAt, 'Wikivault') : `${r.driveLetter}:\\Wikivault`;
      settings.partition = { driveLetter: r.driveLetter, sourceLetter: info.driveLetter, sizeBytes: r.sizeBytes, root: r.mountAt || `${r.driveLetter}:\\` };
      saveSettings();
      return { created: true, driveLetter: r.driveLetter, sizeBytes: r.sizeBytes, dataDir, sourceLetter: info.driveLetter, stagingDir: staged ? info.stagingDir : null };
    } catch (err) {
      log(`partition: ${err.code || 'ERROR'} ${err.message}`);
      return { created: false, code: err.code || 'ERROR', error: err.message, maxBytes: err.maxBytes ?? null, driveLetter: err.driveLetter || null };
    }
  });

  handle('edition:check', async () => { await editions.check(); return editions.snapshot(); });
  handle('edition:update', async () => { await ensureEngineBinary(); editions.update(); return true; });
  handle('edition:pause', () => editions.pause());
  handle('edition:cancel', () => editions.cancel());

  handle('library:extra-info', ({ id }) => extraInfo(String(id)));
  handle('library:extra-download', ({ id }) => downloadExtra(String(id)));
  handle('library:extra-cancel', async ({ id }) => { await extras.get(String(id))?.manager.cancel(); return true; });
  handle('library:extra-remove', ({ id }) => removeExtra(String(id)));
  handle('library:select', ({ id }) => {
    const want = String(id);
    if (golfInPlay() && want !== activeLib) throw new Error('A round of wiki golf is in progress. Finish or end it before changing library.');
    if (want !== 'wikipedia' && !extras.get(want)?.engine?.running) throw new Error('That library is not downloaded yet.');
    if (want !== activeLib) { activeLib = want; conversation.length = 0; }
    pushState();
    return { homeUrl: cur().homeUrl() };
  });
  const inMaps = (fn) => (arg) => { if (!maps) throw new Error('Set up the library first.'); return fn(arg || {}); };
  const mapRegions = (a) => (Array.isArray(a.regions) ? a.regions.map(String) : []);
  const mapJob = (name, p) => { p.then((r) => log(`maps: ${name} ${r ? 'finished' : 'stopped'}`)).catch((err) => log(`maps: ${name}: ${err.message}`)); return true; };
  handle('maps:measure', inMaps((a) => { if (maps.status().job) throw new Error('Something is already being fetched for the map.'); return mapJob('measure', maps.measure(mapRegions(a))); }));
  handle('maps:download', inMaps(async (a) => {
    if (!libraryChosen()) throw new Error('Choose where the library lives first, on the Setup page. The map is kept in the same library.');
    if (maps.status().job) throw new Error('Something is already being fetched for the map.');
    const free = await freeAt(settings.dataDir);
    return mapJob('map', maps.downloadMap(mapRegions(a), Number(a.zoom), { free }));
  }));
  handle('maps:places', inMaps((a) => { if (maps.status().job) throw new Error('Something is already being fetched for the map.'); return mapJob('places', maps.downloadPlaces(mapRegions(a), { near: placesNear(a), how: a && (a.how === 'pieces' || a.how === 'extract') ? a.how : null }).then((r) => { if (r) refreshPlacing(); return r; })); }));
  handle('maps:cancel', inMaps(() => { maps.cancel(); return true; }));
  handle('maps:search', inMaps((a) => {
    const r = maps.search({ q: String(a.q || ''), categories: Array.isArray(a.categories) ? a.categories.map(String) : null, near: Array.isArray(a.near) ? a.near.map(Number) : null, box: Array.isArray(a.box) ? a.box.map(Number) : null, around: Array.isArray(a.around) ? a.around.map(Number) : null, limit: Number(a.limit) || 50 });
    // People and places from the address book come first, when words were typed and no kind of place was chosen.
    const saved = String(a.q || '').trim() && !(Array.isArray(a.categories) && a.categories.length) && !a.box ? bookHits(String(a.q)) : [];
    return saved.length ? { total: r.total + saved.length, hits: [...saved, ...r.hits] } : r;
  }));
  handle('maps:places-discard', inMaps(() => maps.discardPlacesWork().then(() => { pushState(); return true; })));
  handle('maps:places-measure', inMaps((a) => { if (maps.status().job) throw new Error('Something is already being fetched for the map.'); return mapJob('places sizes', maps.measurePlaces(mapRegions(a))); }));
  handle('maps:routing-measure', inMaps((a) => { if (maps.status().job) throw new Error('Something is already being fetched for the map.'); return mapJob('routing sizes', maps.measureRouting(mapRegions(a))); }));
  handle('maps:routing-download', inMaps(async (a) => {
    if (!libraryChosen()) throw new Error('Choose where the library lives first, on the Setup page. The routing data is kept in the same library.');
    if (maps.status().job) throw new Error('Something is already being fetched for the map.');
    return mapJob('routing data', maps.downloadRouting(mapRegions(a), { free: await freeAt(settings.dataDir) }));
  }));
  handle('maps:overture-measure', inMaps((a) => { if (maps.status().job) throw new Error('Something is already being fetched for the map.'); return mapJob('Overture sizes', maps.measureOverture(mapRegions(a))); }));
  handle('gps:want', ({ id }) => { gpsWanted = id ? String(id) : null; return true; });
  handle('gps:fake', () => { try { return process.env.WIKIVAULT_GPS_FAKE ? fs.readFileSync(process.env.WIKIVAULT_GPS_FAKE, 'utf8') : null; } catch { return null; } });

  handle('hub:save', (patch) => {
    const p = patch || {};
    if ('seenVersion' in p) settings.hub.seenVersion = p.seenVersion ? String(p.seenVersion) : null;
    if ('running' in p) settings.hub.running = Boolean(p.running);
    if (p.want && typeof p.want === 'object') settings.hub.want = JSON.parse(JSON.stringify(p.want));
    saveSettings(); pushState();
    return true;
  });

  handle('book:list', () => ({ entries: book.list(), ...bookState() }));
  handle('book:put', (e) => { const r = book.put(e || {}); pushState(); lookupAddresses().catch(() => {}); return r; });
  handle('book:remove', ({ id }) => { const r = book.remove(String(id)); pushState(); return r; });
  handle('book:locate-all', () => { const r = book.locateAll(); pushState(); lookupAddresses().catch(() => {}); return r; });
  // The user's answer to "may addresses be looked up online?", and the lookup itself when the answer is yes.
  handle('book:lookup', async ({ allow }) => {
    settings.contacts.lookup = Boolean(allow); saveSettings(); pushState();
    return allow ? lookupAddresses(true) : null;
  });
  handle('book:import-file', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a contacts file', properties: ['openFile'], filters: [{ name: 'Contacts (vCard or CSV)', extensions: ['vcf', 'vcard', 'csv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const contacts = vcard.parseAny(await fsp.readFile(r.filePaths[0], 'utf8'));
    if (!contacts.length) throw new Error('No contacts were found in that file. It should be a vCard (.vcf) file, or a CSV file exported from Google Contacts or Outlook.');
    const out = book.importContacts(contacts, 'file', { name: path.basename(r.filePaths[0]) });
    pushState();
    lookupAddresses().catch(() => {});
    return out;
  });
  handle('book:google-connect', async ({ clientId, clientSecret }) => {
    if (!(await canSeal())) throw new Error('This computer cannot keep a sign-in safely, so the account was not connected.');
    const id = String(clientId || '').trim(); const secret = String(clientSecret || '').trim();
    bookBusy = 'Waiting for the Google sign-in to finish in your browser'; pushState();
    try {
      const { refreshToken } = await contactsSync.googleSignIn({ clientId: id, clientSecret: secret, endpoints: googleEndpoints(), open: openSignIn });
      await writeSecrets({ ...readSecrets(), google: { clientId: id, clientSecret: secret, refreshToken } });
    } finally { bookBusy = null; pushState(); }
    return syncContacts('google', true);
  });
  handle('book:google-password', async ({ user, password }) => {
    if (!(await canSeal())) throw new Error('This computer cannot keep a sign-in safely, so the account was not connected.');
    const account = { user: String(user || '').trim(), password: String(password || '').replace(/\s+/g, '') };
    // Tried first, and only kept if Google accepts it.
    secrets = { ...secrets, googleTrial: account };
    try { const r = await syncContacts('googleTrial', true); const { googleTrial, ...rest } = secrets; await writeSecrets({ ...rest, google: account }); pushState(); return r; } catch (err) { const { googleTrial, ...rest } = secrets; secrets = rest; throw err; }
  });
  handle('book:icloud-connect', async ({ user, password }) => {
    if (!(await canSeal())) throw new Error('This computer cannot keep a sign-in safely, so the account was not connected.');
    const account = { user: String(user || '').trim(), password: String(password || '').replace(/\s+/g, '') };
    // Tried first, and only kept if Apple accepts it.
    secrets = { ...secrets, icloudTrial: account };
    try { const r = await syncContacts('icloudTrial', true); const { icloudTrial, ...rest } = secrets; await writeSecrets({ ...rest, icloud: account }); pushState(); return r; } catch (err) { const { icloudTrial, ...rest } = secrets; secrets = rest; throw err; }
  });
  handle('book:sync', async ({ source } = {}) => {
    const out = {};
    for (const s of ['google', 'icloud']) if ((!source || source === s) && readSecrets()[s]) out[s] = await syncContacts(s, true);
    return out;
  });
  handle('book:disconnect', async ({ source, keep }) => {
    const s = String(source);
    const { [s]: gone, ...rest } = readSecrets(); await writeSecrets(rest);
    book.dropSource(s, Boolean(keep));
    pushState();
    return true;
  });
  handle('book:every', ({ hours }) => { settings.contacts.everyHours = Math.min(720, Math.max(1, Math.round(Number(hours) || 24))); saveSettings(); pushState(); return true; });

  handle('maps:overture-download', inMaps(async (a) => {
    if (!libraryChosen()) throw new Error('Choose where the library lives first, on the Setup page. The addresses and places are kept in the same library.');
    if (maps.status().job) throw new Error('Something is already being fetched for the map.');
    const kinds = ['places', 'addresses'].filter((k) => Array.isArray(a.kinds) && a.kinds.includes(k));
    if (!kinds.length) throw new Error('Choose addresses, places or both.');
    // With new address data, addresses in the book that could not be placed before are tried again.
    return mapJob('Overture data', maps.downloadOverture(mapRegions(a), { kinds, free: await freeAt(settings.dataDir) }).then((r) => { if (r) refreshPlacing(); return r; }));
  }));
  handle('maps:address', inMaps((a) => maps.findAddress(String(a.q || ''), Array.isArray(a.near) ? a.near.map(Number) : null)));
  handle('maps:route', inMaps(async (a) => {
    if (!maps.routing) throw new Error('Download the routing data first, under Change or update.');
    const pt = (p) => { if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => Number.isFinite(Number(v)))) throw new Error('A route needs a start and an end.'); return [Number(p[0]), Number(p[1])]; };
    const o = {
      points: (Array.isArray(a.points) ? a.points : []).map(pt), mode: String(a.mode || 'car'), alt: Number(a.alt) || 0, noMotorways: Boolean(a.noMotorways),
      blocks: (Array.isArray(a.blocks) ? a.blocks : []).slice(0, 40).map((b) => (Array.isArray(b.polygon) ? { polygon: b.polygon.map(pt) } : { lon: Number(b.lon), lat: Number(b.lat), radius: Number(b.radius) })).filter((b) => b.polygon || (Number.isFinite(b.lon) && Number.isFinite(b.lat) && b.radius > 0)),
    };
    let answer;
    try { answer = await getRouteEngine().ask((origin) => routing.routeUrl(origin, o)); } catch (err) { throw new Error(err.engine ? routing.explain(err.message) : err.message); }
    // The engine's data has no road names; they are read from the map at each turn.
    const wanted = [];
    routing.parseRoute(answer, (lon, lat) => { wanted.push([lon, lat]); return ''; });
    const names = await maps.roadNames(wanted);
    const route = routing.parseRoute(answer, (lon, lat) => names.get(`${lon},${lat}`) || '');
    return { ...route, alt: o.alt, mode: o.mode, named: names.size > 0 };
  }));
  handle('maps:origin', inMaps(async () => (await startSchoolServer()).origin));
  const inSchool = (fn) => (arg) => { if (!featuresNow().school) throw new Error('School is not part of this version yet.'); if (!school) throw new Error('Set up the library first.'); return fn(arg || {}); };
  handle('school:overview', inSchool(() => school.overview()));
  handle('school:week', inSchool(({ number }) => school.week(Number(number) || school.currentWeek())));
  handle('school:lesson', inSchool(({ id }) => { const l = school.lesson(String(id)); if (!l) throw new Error('That lesson is not in the plan. A unit may have been skipped.'); return l; }));
  handle('school:download', inSchool(async () => {
    if (!libraryChosen()) throw new Error('Choose where the library lives first, on the Setup page; the school files are kept in the same library.');
    const free = await freeAt(settings.dataDir);
    if (free != null && free < 4 * 2 ** 30) throw new Error(`The school files for one grade need a few gigabytes and the library drive has ${(free / 2 ** 30).toFixed(1)} GB free.`);
    school.downloadAll().then((r) => log(`school: download ${r.stopped ? 'stopped' : 'finished'}, ${r.failed.length} failed`)).catch((err) => log(`school: ${err.message}`));
    return true;
  }));
  handle('school:cancel', inSchool(() => { school.cancel(); return true; }));
  handle('school:search', inSchool(({ q }) => school.search(String(q || ''))));
  handle('school:done', inSchool(async ({ ids, done }) => { await school.setDone(ids, Boolean(done)); return true; }));
  handle('school:skip', inSchool(async ({ unitId, skip }) => { await school.setSkip(String(unitId), Boolean(skip)); return true; }));
  handle('school:have', inSchool(async ({ id, have }) => { await school.setHave(String(id), Boolean(have)); return true; }));
  handle('school:open', inSchool(async ({ fileId, page, lesson }) => {
    const f = school.fileById(String(fileId));
    if (!f || !school.have.has(f.id)) throw new Error('That file has not been downloaded yet.');
    const { origin } = await startSchoolServer();
    const n = Math.max(1, Number(page) || 1);
    schoolOpens += 1; // a new address each time: opening the same book at another page must load afresh for the viewer to go there
    // Beside the steps of a guided lesson the book has less room: no thumbnails, and the page fitted to the width.
    return { url: `${origin}/f/${f.id}.pdf?open=${schoolOpens}#page=${n}${lesson ? '&navpanes=0&view=FitH' : ''}`, label: f.added ? f.label : `${f.subjectName}, ${f.where}: ${f.label}`, page: n };
  }));
  handle('school:add-books', inSchool(async () => {
    let paths = process.env.WIKIVAULT_TEST_ADD_BOOK ? [process.env.WIKIVAULT_TEST_ADD_BOOK] : null;
    if (!paths) {
      const r = await dialog.showOpenDialog(win, { title: 'Add PDF books to School', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled) return 0;
      paths = r.filePaths;
    }
    return school.addBooks(paths);
  }));
  handle('school:remove-book', inSchool(async ({ id }) => { await school.removeBook(String(id)); return true; }));
  handle('golf:start', ({ playerIds, holes, length, handicaps }) => {
    if (!cur()?.running) throw new Error('There is no library to play in yet.');
    const roster = clubStore().list();
    const players = (Array.isArray(playerIds) ? playerIds : []).map((id) => roster.find((p) => p.id === id)).filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, character: p.character, colour: p.colour, handicap: p.handicap }));
    if (!players.length) throw new Error('Choose at least one player.');
    const libId = curLibId();
    golf = { engine: cur(), libId, recorded: false, game: new GolfGame({ players, holes, length, useHandicaps: Boolean(handicaps), library: libId === 'wikipedia' ? 'Wikipedia' : LIBRARIES[libId].name }) };
    log(`golf: round started in ${golf.game.library}: ${players.length} player(s), ${golf.game.holeCount} hole(s), ${golf.game.length}`);
    layGolfHole();
    return true;
  });
  const inGolf = (fn) => (arg) => {
    if (!golfState()) throw new Error('No round of wiki golf is in progress.');
    const out = fn(golf.game, arg || {});
    if (golf.game.phase === 'layout' && !golf.game.error) layGolfHole(); else pushState();
    return out ?? true;
  };
  handle('golf:relay', inGolf((game) => { if (game.phase === 'layout') game.error = null; else game.relay(); }));
  handle('golf:tee', inGolf((game) => ({ url: game.teeOff() })));
  // Every page the reader arrives at during a turn, and what the game made of it, goes in the log.
  const golfSaw = (how, url, what) => {
    if (golf?.game.phase === 'playing' || what) log(`golf: ${how} ${url} -> ${what || 'not counted'}`);
    if (what) pushState();
    return what;
  };
  handle('golf:visit', ({ url }) => (golfState() ? golfSaw('at', String(url || ''), golf.game.visit(String(url || ''))) : null));
  handle('golf:title', ({ url, title }) => {
    if (!golfState() || golf.game.phase !== 'playing') return null;
    const what = golf.game.titled(String(url || ''), String(title || ''));
    return what ? golfSaw(`title "${String(title).slice(0, 80)}" at`, String(url || ''), what) : null;
  });
  handle('golf:give-up', inGolf((game) => game.giveUp()));
  handle('golf:next', async () => {
    if (!golfState()) throw new Error('No round of wiki golf is in progress.');
    const g = golf;
    g.game.next();
    if (g.game.phase === 'finished' && !g.recorded) {
      g.recorded = true;
      await clubStore().recordRound(g.game.result()).catch((err) => log(`golf: the round could not be saved: ${err.message}`));
    }
    if (g.game.phase === 'layout') layGolfHole(); else pushState();
    return true;
  });
  handle('golf:player-save', async (player) => { const id = await clubStore().savePlayer(player); pushState(); return id; });
  handle('golf:player-delete', async ({ id }) => {
    if (golfInPlay() && golf.game.profiles.some((p) => p.id === id)) throw new Error('That player is in the round being played.');
    await clubStore().deletePlayer(String(id));
    pushState();
    return true;
  });
  handle('golf:quit', () => { if (golf) log('golf: round closed'); golf = null; pushState(); return true; });
  handle('search:suggest', ({ term }) => (cur()?.running ? cur().suggest(term, 8) : []));
  handle('search:query', ({ q, start = 0 }) => (cur()?.running ? smartSearch(cur(), q, { start, pageLength: 20 }) : { total: 0, items: [], nextStart: 0, usedQuery: q, dropped: [] }));

  handle('ask:start', ({ question, pinnedUrl, retry, here, around, articles }) => {
    const mapsReady = Boolean(maps || (book && book.entries.length));
    if (!cur()?.running && !mapsReady) throw new Error('There is no edition on this laptop yet.');
    // Asking the same question again once answers are set up: forget the passages-only attempt,
    // so the question is not mistaken for a follow-up to itself.
    if (retry && conversation.at(-1)?.question === question) conversation.pop();
    const id = ++askSeq;
    const ac = new AbortController();
    asks.set(id, ac);
    lastAiUse = Date.now();
    const emit = (type, data = {}) => send('ask:event', { id, type, ...data });
    (async () => {
      let model = null;
      let modelNote = null;
      // Let the caller have the id of this question before anything is said about it: a map request is answered at once.
      await new Promise((r) => setImmediate(r));
      // A request about the map (directions, where someone lives) is carried out on the map, not answered from the articles.
      if (!articles && !pinnedUrl && mapsReady) {
        const spot = (p) => (p && Number.isFinite(Number(p.lon)) && Number.isFinite(Number(p.lat)) ? { lon: Number(p.lon), lat: Number(p.lat), label: String(p.label || 'My position').slice(0, 80) } : null);
        const centre = Array.isArray(around) && around.length === 2 && around.every((v) => Number.isFinite(Number(v))) ? around.map(Number) : null;
        const plan = await mapAsk.understand(String(question || ''), {
          book, here: spot(here), signal: ac.signal, onStatus: (text) => emit('status', { text }),
          search: (q) => {
            try {
              if (!maps) return null;
              const first = maps.search({ q, limit: 1, around: centre }).hits[0] || null;
              // A town's name with nothing else: of the towns so named, the nearest to you, to home, or to where the map is looking,
              // not the largest one in the country.
              if (first && first.c === 'town' && !/\d/.test(q)) {
                const same = (s) => String(s || '').trim().toLowerCase();
                const all = maps.search({ categories: ['town'], q, limit: 60 }).hits.filter((h) => same(h.n) === same(first.n));
                const ref = spot(here) || placesNear(null) || (centre ? { lon: centre[0], lat: centre[1] } : null);
                if (all.length > 1 && ref) { const far = (h) => Math.hypot(h.a - ref.lat, (h.o - ref.lon) * Math.cos(ref.lat * Math.PI / 180)); return all.reduce((a, b) => (far(b) < far(a) ? b : a)); }
              }
              return first;
            } catch { return null; }
          },
          // The places of some kinds (or, with no kind, of some name), nearest first, each with its distance.
          nearby: maps ? ({ cats, q = '', near, limit = 50 }) => { try { return maps.search({ categories: cats && cats.length ? cats : maps.registry.categories.map((c) => c.id), q, near, limit }).hits; } catch { return []; } } : null,
          kinds: maps ? Object.fromEntries(maps.registry.categories.map((c) => [c.id, c.name])) : {},
          sizes: maps ? (cats) => maps.sizeBands(cats) : null,
          last: lastMapPlace,
          model: settings.ai.enabled ? async () => { emit('status', { text: 'Getting the local model ready' }); await llm.prepare({ signal: ac.signal, onStatus: (text) => emit('status', { text }) }); pushState(); return llm; } : null,
        });
        if (plan) {
          log(`ask: map request (${plan.kind}${plan.error ? ', not carried out' : ''})`);
          // "there", in the next request, is the place this one was about: the place shown, the destination, or the nearest one found.
          if (!plan.error) { const p = plan.kind === 'near' ? (plan.hits[0] && { lon: plan.hits[0].o, lat: plan.hits[0].a, label: plan.hits[0].n || plan.names }) : plan.to; if (p) lastMapPlace = { lon: p.lon, lat: p.lat, label: p.label, ...(p.approx ? { approx: p.approx, how: p.how } : {}) }; }
          emit('understood', { text: plan.said });
          emit('map', { plan: { ...plan, routing: Boolean(maps && maps.routing), hasMap: Boolean(maps && maps.status().map) } });
          return;
        }
      }
      if (!cur()?.running) throw new Error('There is no edition on this laptop yet, so only requests about the map and your saved places can be answered.');
      if (settings.ai.enabled) {
        try {
          emit('status', { text: 'Getting the local model ready' });
          await llm.prepare({ signal: ac.signal, onStatus: (text) => emit('status', { text }) });
          model = llm;
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          modelNote = err.message;
        }
        pushState();
      }
      const out = await answerQuestion({
        engine: cur(), llm: model, question, pinnedUrl: pinnedUrl || null,
        history: conversation.slice(),
        settings: settings.ai, source: curLibId() === 'wikipedia' ? 'Wikipedia' : LIBRARIES[curLibId()].name, editionDate: (curLibId() === 'wikipedia' ? editions : extras.get(curLibId())?.manager)?.snapshot().active?.date,
        signal: ac.signal,
        onStatus: (text) => emit('status', { text }),
        onUnderstood: (text) => emit('understood', { text }),
        onToken: (text) => emit('token', { text }),
        onSources: (passages) => emit('sources', { passages }),
      });
      if (!out.empty) {
        conversation.push({ question, standalone: out.standalone, answer: out.text, sources: turnSources(out.text, out.passages) });
        conversation = conversation.slice(-MAX_TURNS);
      }
      emit('done', { text: out.text, empty: Boolean(out.empty), passagesOnly: Boolean(out.passagesOnly), modelNote, aiState: llm.status().state, device: llm.status().device });
    })().catch((err) => {
      if (err.name === 'AbortError') emit('stopped');
      else { log(`ask failed: ${err.message}`); emit('error', { message: err.message, partial: err.partial || '' }); }
    }).finally(() => { asks.delete(id); lastAiUse = Date.now(); });
    return id;
  });
  handle('ask:cancel', ({ id }) => { asks.get(id)?.abort('stopped'); return true; });
  handle('ask:reset', () => {
    for (const ac of asks.values()) ac.abort('stopped');
    conversation = [];
    lastMapPlace = null;
    return true;
  });

  handle('ai:setup', setupAnswers);
  handle('ai:prepare', async () => {
    llm.invalidate();
    aiBusy = 'Getting the local model ready';
    pushState();
    try {
      await llm.prepare({ allowDownload: true, onStatus: (text) => { aiBusy = text; pushState(); } });
    } finally { aiBusy = null; pushState(); }
    return llm.status();
  });
  handle('ai:install-foundry', async () => {
    aiBusy = 'Installing Foundry Local';
    pushState();
    try {
      await llm.installFoundry((line) => { aiBusy = `Installing Foundry Local: ${line.slice(0, 70)}`; pushState(); });
    } finally { aiBusy = null; pushState(); }
    return true;
  });
  handle('ai:models', () => llm.listFoundryModels());
  handle('ai:catalog', async () => {
    const families = await llm.listFoundryModels();
    const inUse = String(llm.status().modelId || '').toLowerCase();
    // A build that is answering questions is on this computer, wherever Foundry Local keeps it.
    const tests = settings.ai.speedTests || {};
    // Where Foundry Local's cache cannot be read, one that has been timed here counts too: it had to be downloaded for that.
    const blind = !llm.cacheReadable();
    for (const f of families) for (const b of f.builds) if (b.id.toLowerCase() === inUse || (blind && tests[b.id] && !tests[b.id].error && !tests[b.id].removed)) b.cached = true;
    return { families, tests };
  });
  handle('ai:speed-test', ({ ids, allowDownload }) => runSpeedTests({ ids: (ids || []).map(String).slice(0, 6), allowDownload: Boolean(allowDownload) }));
  handle('ai:speed-cancel', () => { speedAbort?.abort(); return true; });
  handle('ai:use-model', ({ id }) => useModel(String(id)));
  handle('ai:remove-download', async ({ id }) => {
    const out = await removeDownloads([String(id)]);
    if (!out.removed.length) throw new Error(out.kept[0]?.reason || 'That build is in use, so its download was kept.');
    return out;
  });
  handle('ai:tune-plan', tunePlan);
  handle('ai:tune-run', tuneRun);

  handle('settings:set', (patch) => {
    const top = ['autoUpdate', 'checkIntervalHours', 'keepInTray', 'launchAtLogin', 'downloadConnections'];
    const ai = ['enabled', 'provider', 'foundryModel', 'baseUrl', 'model', 'apiKey', 'contextChars', 'maxAnswerTokens', 'rewriteQueries', 'idleMinutes', 'tunePreference'];
    for (const k of top) if (k in patch) settings[k] = patch[k];
    if (patch.ai) {
      for (const k of ai) if (k in patch.ai) settings.ai[k] = patch.ai[k];
      settings.ai.contextChars = Math.min(24000, Math.max(1500, Number(settings.ai.contextChars) || 6000));
      settings.ai.idleMinutes = Math.min(240, Math.max(0, Number(settings.ai.idleMinutes) || 0));
      settings.ai.tunePreference = Math.min(4, Math.max(0, Math.round(Number(settings.ai.tunePreference ?? 2))));
      settings.ai.maxAnswerTokens = Math.min(2000, Math.max(100, Number(settings.ai.maxAnswerTokens) || 400));
      llm.invalidate();
      llm._setState('unknown', '');
    }
    settings.downloadConnections = Math.min(16, Math.max(1, Math.round(Number(settings.downloadConnections) || 8)));
    saveSettings();
    applyLoginItem();
    pushState();
    return true;
  });

  handle('shell:open-external', ({ url }) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only web links can be opened.');
    return shell.openExternal(url);
  });
  handle('setup:flavours', flavourSizes);
  handle('library:flavours', flavourOptions);
  handle('library:set-flavour', ({ flavour }) => changeFlavour(String(flavour)));
  handle('setup:set-flavour', ({ flavour }) => {
    if (!FLAVOURS.some((f) => f.flavour === flavour)) throw new Error('Unknown edition size.');
    if (settings.flavour !== flavour) { settings.flavour = flavour; editionSizeCache = null; saveSettings(); pushState(); }
    return true;
  });
  handle('disk:free', async ({ dir }) => {
    let probe = path.resolve(String(dir || ''));
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    return freeBytes(probe);
  });
  handle('library:move', async ({ toDir }) => {
    if (!toDir) throw new Error('Choose a folder first.');
    if (maintenance && !maintenance.error) throw new Error('Another library operation is already running.');
    try {
      const r = await moveLibrary(toDir, 'move');
      setMaintenance(null);
      return r;
    } catch (err) {
      setMaintenance({ kind: 'move', step: null, done: null, error: err.message });
      throw err;
    }
  });
  handle('library:dismiss-maintenance', () => { if (maintenance?.error) setMaintenance(null); return true; });
  handle('partition:status', partitionStatus);
  handle('partition:plan', partitionPlan);
  handle('partition:change', (opts) => {
    if (maintenance && !maintenance.error) throw new Error('Another library operation is already running.');
    return changePartition({ sizeBytes: opts.sizeBytes, staged: Boolean(opts.staged), allowBattery: Boolean(opts.allowBattery) });
  });
  handle('partition:revert', (opts) => {
    if (maintenance && !maintenance.error) throw new Error('Another library operation is already running.');
    return revertPartition(opts);
  });

  handle('tour:done', ({ hide }) => {
    tourThisRun();
    tourRun.done = true;
    settings.tour = { hide: hide == null ? settings.tour.hide : Boolean(hide), seenVersion: app.getVersion() };
    saveSettings();
    pushState();
    return true;
  });
  handle('app:acknowledge', () => { settings.acknowledged = TERMS_VERSION; settings.acknowledgedAt = new Date().toISOString(); saveSettings(); pushState(); return true; });
  handle('shell:open-notices', ({ which }) => {
    const name = which === 'licence' ? ['LICENSE.txt', 'LICENSE'] : ['THIRD-PARTY-NOTICES.txt'];
    // Installed: next to the program. From source: in the project folder.
    const places = [path.dirname(process.execPath), app.getAppPath()];
    for (const dir of places) for (const n of name) { const file = path.join(dir, n); if (fs.existsSync(file)) return shell.openPath(file); }
    throw new Error('The notices file was not found with this copy of the app.');
  });
  handle('shell:open-data-dir', () => shell.openPath(editions?.snapshot().active ? path.dirname(editions.snapshot().active.path) : settings.dataDir));
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--quit')) { quitting = true; app.quit(); } else showWindow();
  });

  app.whenReady().then(async () => {
    if (QUIT_REQUEST) { app.quit(); return; } // no copy was running; nothing to close
    loadSettings();
    log(`Wikivault ${app.getVersion()} starting on ${process.platform} ${process.arch}, Electron ${process.versions.electron}`);
    lockAppSession();
    initBook();
    registerIpc();
    setTimeout(() => contactsDue().catch(() => {}), 45000);
    setInterval(() => contactsDue().catch(() => {}), 3600 * 1000).unref();
    setTimeout(() => lookupAddresses().catch(() => {}), 60000); // addresses still unplaced from a time with no connection
    await reapOrphanEngine();
    // Keep the window's idea of the power state current.
    powerMonitor.on('on-ac', pushState);
    powerMonitor.on('on-battery', pushState);
    createTray();
    createWindow();
    startIdleWatch();
    if (settings.dataDir) {
      await initLibrary().catch((err) => log(`library init failed: ${err.stack || err.message}`));
    }
    applyLoginItem();
    syncRegistry();
    pushState();
    detectPartition();
    // Finish what the installer (or an earlier run) was asked to do.
    await refreshWindowsPath();
    await readInstallerChoice();
    if (settings.ai.autoSetup === 'pending' && settings.ai.enabled) setupAnswers().catch(() => {});
  });

  app.on('window-all-closed', () => {
    if (!(settings.keepInTray && tray && settings.dataDir)) { quitting = true; app.quit(); }
  });
  app.on('activate', showWindow);

  let memoryReleased = false;
  app.on('before-quit', (event) => {
    if (!memoryReleased) {
      // Unload the model and stop Foundry Local's service before going, but never hang on it.
      memoryReleased = true;
      event.preventDefault();
      for (const ac of asks.values()) ac.abort('quit');
      speedAbort?.abort();
      school?.cancel();
      maps?.cancel();
      stopRouteEngine();
      stopIndexer();
      const release = llm.releaseMemory({ stopService: true, also: ourModelIds() }).catch(() => {});
      Promise.race([release, new Promise((r) => setTimeout(r, 5000))]).finally(() => app.quit());
    }
    quitting = true;
    editions?.stopSchedule();
    // Not a user pause: the download resumes by itself next time the app runs.
    editions?.abort?.abort('quit');
    for (const ac of asks.values()) ac.abort('quit');
    if (engine) engine.stopping = true;
    try { engine?.proc?.kill(); } catch { /* already gone */ }
    for (const x of extras.values()) { if (x.engine) { x.engine.stopping = true; try { x.engine.proc?.kill(); } catch { /* already gone */ } } }
    try { fs.rmSync(enginePidFile(), { force: true }); } catch { /* fine */ }
  });
}
