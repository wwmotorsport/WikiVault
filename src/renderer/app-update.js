'use strict';
// A newer version of the app itself: the bar under the top of the window that says there is one, and the lines
// about it in the About group. Shares the page with app.js and uses its helpers ($, state, guard, bytes).

function paintAppUpdate() {
  const u = state && state.appUpdate;
  if (!u || !$('app-update')) return;
  const n = u.newer;
  // The bar: shown for a version until "Later" is pressed for that version; the About group always has it.
  const put = n && localStorage.getItem('wikivault-update-later') !== n.latest;
  $('app-update').hidden = !put;
  if (n) {
    $('app-update-text').textContent = `Wikivault ${n.latest} is available. This is version ${state.version}.`;
    $('app-update-get').textContent = n.direct ? `Download the installer${n.bytes ? ` (${bytes(n.bytes)})` : ''}` : 'Open the download page';
  }
  const when = u.checked ? new Date(u.checked).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  $('about-update-status').textContent = n ? `Version ${n.latest} is available${n.published ? `, published on ${new Date(n.published).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}. This is version ${state.version}. The installer is downloaded by your web browser; run it and it installs over this copy, keeping the library and your settings.`
    : u.error ? u.error
      : u.checked ? `This is the newest version (${state.version}). Looked on ${when}.`
        : u.on ? `This is version ${state.version}. Not looked yet; it looks a little after the app starts, when there is a connection.` : `This is version ${state.version}. Looking for newer versions is switched off.`;
  $('about-update-get').hidden = !n; $('about-update-what').hidden = !n;
  if (n) $('about-update-get').textContent = $('app-update-get').textContent;
  if (document.activeElement !== $('about-update-auto')) $('about-update-auto').checked = u.on;
}
const appUpdateOpen = (which) => () => { const n = state.appUpdate && state.appUpdate.newer; if (n) guard(() => api.openExternal(which === 'page' ? n.page : n.url), $('about-error')); };
$('app-update-get').addEventListener('click', appUpdateOpen('get'));
$('about-update-get').addEventListener('click', appUpdateOpen('get'));
$('app-update-what').addEventListener('click', appUpdateOpen('page'));
$('about-update-what').addEventListener('click', appUpdateOpen('page'));
$('app-update-later').addEventListener('click', () => { const n = state.appUpdate && state.appUpdate.newer; if (n) localStorage.setItem('wikivault-update-later', n.latest); paintAppUpdate(); });
$('about-update-check').addEventListener('click', () => { $('about-update-status').textContent = 'Looking...'; guard(() => api.appCheckUpdate(), $('about-error')); });
$('about-update-auto').addEventListener('change', () => guard(() => api.appSetUpdates($('about-update-auto').checked), $('about-error')));
