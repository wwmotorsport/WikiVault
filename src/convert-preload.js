'use strict';
// The bridge of the converter window (src/renderer/guide-convert.html). That window reads PDFs that were
// downloaded, so it gets the least there is: it asks for the next PDF, hands back each page, and says when it is done.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('convert', {
  next: () => ipcRenderer.invoke('convert:next'),
  page: (p) => ipcRenderer.invoke('convert:page', p),
  done: (p) => ipcRenderer.invoke('convert:done', p),
});
