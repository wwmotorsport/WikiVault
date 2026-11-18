'use strict';
// The only bridge between the UI and the main process. Each call returns the
// value or throws an Error with a plain-language message.

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, arg) {
  const res = await ipcRenderer.invoke(channel, arg);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

const listen = (channel) => (fn) => {
  const handler = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  getState: () => call('state:get'),
  chooseDir: () => call('setup:choose-dir'),
  beginSetup: (opts) => call('setup:begin', opts),
  setupFlavours: () => call('setup:flavours'),
  libraryFlavours: () => call('library:flavours'),
  changeFlavour: (flavour) => call('library:set-flavour', { flavour }),
  extraInfo: (id) => call('library:extra-info', { id }),
  extraDownload: (id) => call('library:extra-download', { id }),
  extraCancel: (id) => call('library:extra-cancel', { id }),
  extraRemove: (id) => call('library:extra-remove', { id }),
  selectLibrary: (id) => call('library:select', { id }),
  tourDone: (hide) => call('tour:done', { hide }),
  schoolOverview: () => call('school:overview'),
  schoolWeek: (number) => call('school:week', { number }),
  schoolLesson: (id) => call('school:lesson', { id }),
  mapsMeasure: (regions) => call('maps:measure', { regions }),
  mapsDownload: (regions, zoom) => call('maps:download', { regions, zoom }),
  mapsPlaces: (regions) => call('maps:places', { regions }),
  mapsCancel: () => call('maps:cancel'),
  mapsSearch: (o) => call('maps:search', o),
  mapsOrigin: () => call('maps:origin'),
  mapsRoutingMeasure: (regions) => call('maps:routing-measure', { regions }),
  mapsRoutingDownload: (regions) => call('maps:routing-download', { regions }),
  mapsRoute: (o) => call('maps:route', o),
  mapsOvertureMeasure: (regions) => call('maps:overture-measure', { regions }),
  mapsOvertureDownload: (regions, kinds) => call('maps:overture-download', { regions, kinds }),
  mapsAddress: (q, near) => call('maps:address', { q, near }),
  schoolDownload: () => call('school:download'),
  schoolCancel: () => call('school:cancel'),
  schoolSearch: (q) => call('school:search', { q }),
  schoolDone: (ids, done) => call('school:done', { ids, done }),
  schoolSkip: (unitId, skip) => call('school:skip', { unitId, skip }),
  schoolHave: (id, have) => call('school:have', { id, have }),
  schoolOpen: (fileId, page, lesson) => call('school:open', { fileId, page, lesson: Boolean(lesson) }),
  schoolAddBooks: () => call('school:add-books'),
  schoolRemoveBook: (id) => call('school:remove-book', { id }),
  golfStart: (opts) => call('golf:start', opts),
  golfRelay: () => call('golf:relay'),
  golfTee: () => call('golf:tee'),
  golfVisit: (url) => call('golf:visit', { url }),
  golfTitle: (url, title) => call('golf:title', { url, title }),
  golfSavePlayer: (player) => call('golf:player-save', player),
  golfDeletePlayer: (id) => call('golf:player-delete', { id }),
  golfGiveUp: () => call('golf:give-up'),
  golfNext: () => call('golf:next'),
  golfQuit: () => call('golf:quit'),
  setFlavour: (flavour) => call('setup:set-flavour', { flavour }),
  useFile: () => call('setup:use-file'),
  partitionInfo: () => call('partition:info'),
  createPartition: (sizeBytes, staged, allowBattery) => call('partition:create', { sizeBytes, staged, allowBattery }),

  checkEdition: () => call('edition:check'),
  updateEdition: () => call('edition:update'),
  pauseEdition: () => call('edition:pause'),
  cancelEdition: () => call('edition:cancel'),

  suggest: (term) => call('search:suggest', { term }),
  search: (q, start) => call('search:query', { q, start }),

  ask: (question, pinnedUrl, retry) => call('ask:start', { question, pinnedUrl, retry: Boolean(retry) }),
  cancelAsk: (id) => call('ask:cancel', { id }),
  resetAsk: () => call('ask:reset'),

  setupAnswers: () => call('ai:setup'),
  prepareAi: () => call('ai:prepare'),
  installFoundry: () => call('ai:install-foundry'),
  listModels: () => call('ai:models'),
  aiCatalog: () => call('ai:catalog'),
  speedTest: (ids, allowDownload) => call('ai:speed-test', { ids, allowDownload }),
  cancelSpeedTest: () => call('ai:speed-cancel'),
  useModel: (id) => call('ai:use-model', { id }),
  removeDownload: (id) => call('ai:remove-download', { id }),
  tunePlan: () => call('ai:tune-plan'),
  tuneRun: () => call('ai:tune-run'),

  freeSpace: (dir) => call('disk:free', { dir }),
  moveLibrary: (toDir) => call('library:move', { toDir }),
  dismissMaintenance: () => call('library:dismiss-maintenance'),
  partitionStatus: () => call('partition:status'),
  revertPartition: (opts) => call('partition:revert', opts),
  partitionPlan: () => call('partition:plan'),
  partitionChange: (opts) => call('partition:change', opts),

  setSettings: (patch) => call('settings:set', patch),
  openExternal: (url) => call('shell:open-external', { url }),
  openDataDir: () => call('shell:open-data-dir'),
  acknowledge: () => call('app:acknowledge'),
  openNotices: (which) => call('shell:open-notices', { which }),

  onState: listen('state'),
  onAskEvent: listen('ask:event'),
  onExternalLink: listen('external-link'),
  onOpenUrl: listen('open-url'),
  onShortcut: listen('shortcut'),
  onEditionSwitched: listen('edition-switched'),
});
