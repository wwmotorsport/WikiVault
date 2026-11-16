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
