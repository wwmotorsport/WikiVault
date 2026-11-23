'use strict';
// Two things about where the library lives: the notice shown when its drive is not connected, and the check of an
// external drive (how fast it is, and what to look for if it is too slow) when one is chosen as the library's home.
// Shares the page with app.js and uses its helpers ($, el, state, guard).

/**
 * A folder was chosen for the library. When it is on an external drive, say so in `host`, time the drive, and say
 * what was found. Nothing is shown for a drive inside the computer.
 */
async function driveCheck(picked, host) {
  host.hidden = true; host.replaceChildren(); host.className = 'drive-note';
  if (!picked || !picked.drive) return;
  host.hidden = false;
  const d = picked.drive;
  const what = d.network ? 'a network folder' : `an external drive${d.model ? ` (${d.model})` : ''}${d.bus ? `, connected by ${d.bus}` : ''}`;
  const head = el('p', 'drive-head', `This folder is on ${what}. Checking how fast it is, which takes about ten seconds...`);
  host.append(head);
  let r = null;
  try { r = await api.driveTest(picked.dir); } catch (err) { head.textContent = `This folder is on ${what}. Its speed could not be checked: ${err.message}`; return; }
  host.classList.add(r.level);
  head.textContent = `This folder is on ${what}. ${r.title}`;
  if (r.lines && r.lines.length) {
    if (r.level !== 'good') host.append(el('p', 'drive-sub', r.level === 'unusable' ? 'What to do:' : 'For a better one, this is what to look for:'));
    const list = el('ul', '');
    for (const line of r.lines) list.append(el('li', '', line));
    host.append(list);
  }
  const again = el('button', 'btn small', 'Test again');
  again.addEventListener('click', () => driveCheck(picked, host));
  host.append(again);
}

/** The notice that the library's drive is not connected: it stays until the drive is back or another place is chosen. */
function paintMissing() {
  const dlg = $('missing-dialog');
  if (!dlg) return;
  const m = state && state.libraryMissing;
  if (!m) { if (dlg.open) dlg.close(); return; }
  $('missing-dir').textContent = m.dir;
  if (!dlg.open) { $('missing-sure').hidden = true; $('missing-note').textContent = ''; dlg.showModal(); }
}
$('missing-dialog').addEventListener('cancel', (e) => e.preventDefault()); // Esc does not dismiss it: there is no library behind it
$('missing-retry').addEventListener('click', async () => {
  $('missing-note').textContent = 'Looking...';
  const r = await api.missingRetry().catch(() => ({ back: false }));
  $('missing-note').textContent = r.back ? '' : 'It is still not there. Check that the drive is plugged in and shows in File Explorer, then try again. The app also keeps looking by itself.';
});
$('missing-elsewhere').addEventListener('click', () => { $('missing-sure').hidden = false; });
$('missing-no').addEventListener('click', () => { $('missing-sure').hidden = true; });
$('missing-yes').addEventListener('click', () => guard(() => api.missingForget(), null));
