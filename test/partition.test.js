'use strict';
// The partition script is exercised for real (under PowerShell) against mocked
// Windows Storage cmdlets and a pretend disk. Skipped where PowerShell is not
// installed, and always skipped on Windows so a test can never reach a real disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PartitionTool, sizePlan, GB, SCRIPT_SOURCE } = require('../src/core/partition');
const { tmpDir } = require('./helpers');

function findPwsh() {
  if (process.platform === 'win32') return null;
  if (process.env.WIKIVAULT_PWSH) return process.env.WIKIVAULT_PWSH;
  try { return execFileSync('which', ['pwsh'], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const pwsh = findPwsh();
const skip = pwsh ? false : 'PowerShell (pwsh) is not installed, or this is Windows';

const DISK = {
  partitionSize: 953 * GB, sizeMin: 310 * GB, volFree: 700 * GB, largestFreeExtent: 0,
  style: 'GPT', fs: 'NTFS', elevated: true, usedLetters: ['C'], partitionCount: 4, bitlocker: 'FullyEncrypted',
};

async function fixture(disk = {}) {
  const dir = await tmpDir('wikivault-part-');
  const state = path.join(dir, 'disk.json');
  const calls = path.join(dir, 'calls.log');
  fs.writeFileSync(state, JSON.stringify({ ...DISK, ...disk }));
  fs.writeFileSync(calls, '');
  process.env.PART_MOCK_STATE = state;
  process.env.PART_MOCK_CALLS = calls;
  process.env.WIKIVAULT_PWSH = pwsh;
  delete process.env.FAKE_UAC;
  const logs = [];
  return {
    tool: new PartitionTool({ shell: path.join(__dirname, 'partition', 'fake-powershell.js'), log: (m) => logs.push(m) }),
    logs,
    calls: () => fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
    disk: () => JSON.parse(fs.readFileSync(state, 'utf8')),
    done: () => fsp.rm(dir, { recursive: true, force: true }),
  };
}

test('sizes: room for two editions, with growth, capped by what the drive can give', () => {
  const plan = sizePlan({ editionBytes: 115 * GB, volumeFree: 800 * GB, partitionSize: 953 * GB, sizeMin: 200 * GB });
  assert.equal(plan.minBytes / GB, 234);          // 2 x 115 + 4
  assert.equal(plan.recommendedBytes / GB, 270);  // 2 x 115 x 1.15 + 4, rounded up to 10
  assert.equal(plan.maxBytes / GB, 750);          // free space minus 50 GB kept for Windows
  assert.equal(plan.feasible, true);

  const tight = sizePlan({ editionBytes: 115 * GB, volumeFree: 800 * GB, partitionSize: 953 * GB, sizeMin: 700 * GB });
  assert.equal(tight.maxBytes / GB, 253, 'limited by how far Windows can shrink');
  assert.equal(tight.recommendedBytes / GB, 253, 'recommendation never exceeds the maximum');

  const full = sizePlan({ editionBytes: 115 * GB, volumeFree: 200 * GB, partitionSize: 476 * GB, sizeMin: null });
  assert.equal(full.feasible, false);
  assert.equal(full.recommendedBytes, null);
  assert.match(full.reason, /needs at least 234 GB.*keep 50 GB free/);

  const stuck = sizePlan({ editionBytes: 115 * GB, volumeFree: 800 * GB, partitionSize: 953 * GB, sizeMin: 900 * GB });
  assert.match(stuck.reason, /can only shrink this drive by 53 GB/);
});

test('sizes for staged updates: one edition in the partition, room kept on the system drive for the next', () => {
  const plan = sizePlan({ editionBytes: 115 * GB, volumeFree: 700 * GB, partitionSize: 953 * GB, sizeMin: null, editions: 1 });
  assert.equal(plan.minBytes / GB, 123);          // 115 x 1.05 + 2
  assert.equal(plan.recommendedBytes / GB, 160);  // 115 x 1.3 + 4, rounded up to 10
  assert.equal(plan.stagingBytes / GB, 133);      // one edition plus growth stays free on C: for updates
  assert.equal(plan.maxBytes / GB, 517);          // 700 - 50 - 133
  const two = sizePlan({ editionBytes: 115 * GB, volumeFree: 700 * GB, partitionSize: 953 * GB, sizeMin: null, editions: 2 });
  assert.ok(plan.recommendedBytes < two.recommendedBytes - 100 * GB, 'well over 100 GB smaller than the self-contained layout');
  const cramped = sizePlan({ editionBytes: 115 * GB, volumeFree: 290 * GB, partitionSize: 476 * GB, sizeMin: null, editions: 1 });
  assert.equal(cramped.feasible, false);
  assert.match(cramped.reason, /needs at least 123 GB.*keep 183 GB free for Windows and for downloading updates/);
});

test('the script can remove a partition in exactly one, guarded place and wipes nothing else', () => {
  const src = fs.readFileSync(SCRIPT_SOURCE, 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(code, /Clear-Disk|Initialize-Disk|Remove-Item|Set-Disk|diskpart|Reset-PhysicalDisk|Clear-Volume/i);
  assert.equal((code.match(/Remove-Partition/g) || []).length, 1, 'removes a partition in exactly one place');
  assert.match(code, /Remove-Partition -DriveLetter \$other -Confirm:\$false/);
  const guard = code.indexOf("code = 'NOT_SAFE'");
  const elevatedCheck = code.indexOf("'Removing a partition needs administrator approval.'");
  const removal = code.indexOf('Remove-Partition');
  assert.ok(guard > 0 && elevatedCheck > 0 && guard < removal && elevatedCheck < removal, 'the safety checks come before the removal');
  assert.equal((src.match(/Format-Volume/g) || []).length, 1, 'formats in exactly one place');
  assert.match(src, /Format-Volume -DriveLetter \$newLetter /, 'and only ever the volume it just created');
});

test('analyze reads the drive without changing it', { skip }, async () => {
  const f = await fixture({ elevated: false });
  try {
    const a = await f.tool.analyze('C');
    assert.equal(a.partitionSize, 953 * GB);
    assert.equal(a.sizeMin, 310 * GB);
    assert.equal(a.volumeFree, 700 * GB);
    assert.equal(a.partitionStyle, 'GPT');
    assert.equal(a.bitLocker, 'On');
    assert.equal(a.freeLetter, 'W');
    assert.deepEqual(f.calls(), []);
  } finally { await f.done(); }
});

test('analyze copes when Windows withholds the shrink limit from a non-administrator', { skip }, async () => {
  const f = await fixture({ elevated: false, supportedFails: true, bitlocker: '', usedLetters: ['C', 'W', 'V'] });
  try {
    const a = await f.tool.analyze('C');
    assert.equal(a.sizeMin, null);
    assert.equal(a.bitLocker, 'Unknown');
    assert.equal(a.freeLetter, 'X');
  } finally { await f.done(); }
});

test('create: shrinks C:, makes the partition in the freed space, formats only the new volume', { skip }, async () => {
  const f = await fixture();
  try {
    const r = await f.tool.create('C', 270 * GB);
    assert.equal(r.ok, true);
    assert.equal(r.driveLetter, 'W');
    assert.equal(r.sizeBytes, 270 * GB);
    assert.equal(r.sourceSizeBefore, 953 * GB);
    assert.equal(r.sourceSizeAfter, 683 * GB);
    assert.deepEqual(f.calls(), [
      'Stop-Service ShellHWDetection',
      `Resize-Partition C ${683 * GB}`,
      'New-Partition max=True size=0 letter=W',
      'Format-Volume W NTFS Wikivault',
      'Start-Service ShellHWDetection',
    ]);
    assert.ok(f.logs.some((l) => /created W: \(270 GB\)/.test(l)));
  } finally { await f.done(); }
});

test('create: sizes are rounded down to a whole megabyte', { skip }, async () => {
  const f = await fixture();
  try {
    const r = await f.tool.create('C', 270 * GB + 123456);
    assert.equal(r.sizeBytes, 270 * GB);
  } finally { await f.done(); }
});

test('create: refuses, and changes nothing, when Windows cannot shrink that far', { skip }, async () => {
  const f = await fixture({ sizeMin: 800 * GB });
  try {
    await assert.rejects(f.tool.create('C', 270 * GB), (e) => {
      assert.equal(e.code, 'TOO_LARGE');
      assert.equal(e.maxBytes, 153 * GB);
      assert.match(e.message, /at most 153 GB/);
      return true;
    });
    assert.deepEqual(f.calls(), []);
    assert.equal(f.disk().partitionSize, 953 * GB);
  } finally { await f.done(); }
});

test('create: does nothing without administrator rights', { skip }, async () => {
  const f = await fixture({ elevated: false });
  try {
    await assert.rejects(f.tool.create('C', 270 * GB), /needs administrator approval/);
    assert.deepEqual(f.calls(), []);
  } finally { await f.done(); }
});

test('create: a declined administrator prompt is reported as "nothing was changed"', { skip }, async () => {
  const f = await fixture();
  try {
    process.env.FAKE_UAC = 'decline';
    await assert.rejects(f.tool.create('C', 270 * GB), (e) => e.code === 'DECLINED' && /nothing was changed/.test(e.message));
    assert.deepEqual(f.calls(), []);
  } finally { delete process.env.FAKE_UAC; await f.done(); }
});

test('create: if the new partition cannot be made, C: is extended back to its original size', { skip }, async () => {
  const f = await fixture({ failNew: true });
  try {
    await assert.rejects(f.tool.create('C', 270 * GB), (e) => {
      assert.equal(e.code, 'CREATE_FAILED');
      assert.match(e.message, /returned to its original size/);
      return true;
    });
    assert.deepEqual(f.calls(), [
      'Stop-Service ShellHWDetection',
      `Resize-Partition C ${683 * GB}`,
      'New-Partition max=True size=0 letter=W',
      `Resize-Partition C ${953 * GB}`,
      'Start-Service ShellHWDetection',
    ]);
    assert.equal(f.disk().partitionSize, 953 * GB);
  } finally { await f.done(); }
});

test('create: a shrink that Windows rejects leaves the drive as it was', { skip }, async () => {
  const f = await fixture({ failResize: true });
  try {
    await assert.rejects(f.tool.create('C', 270 * GB), /cannot be shrunk/);
    assert.deepEqual(f.calls(), ['Stop-Service ShellHWDetection', `Resize-Partition C ${683 * GB}`, 'Start-Service ShellHWDetection']);
    assert.equal(f.disk().partitionSize, 953 * GB);
  } finally { await f.done(); }
});

test('create: a failed format is reported and nothing is deleted or rolled back blindly', { skip }, async () => {
  const f = await fixture({ failFormat: true });
  try {
    await assert.rejects(f.tool.create('C', 270 * GB), (e) => {
      assert.equal(e.code, 'FORMAT_FAILED');
      assert.equal(e.driveLetter, 'W');
      assert.match(e.message, /created as W: but Windows could not format it/);
      return true;
    });
    assert.equal(f.calls().filter((c) => c.startsWith('Resize-Partition')).length, 1);
  } finally { await f.done(); }
});

test('create: uses unallocated space that already exists instead of shrinking', { skip }, async () => {
  const f = await fixture({ largestFreeExtent: 300 * GB });
  try {
    const r = await f.tool.create('C', 270 * GB);
    assert.equal(r.shrunk, false);
    assert.equal(r.sourceSizeAfter, 953 * GB);
    assert.deepEqual(f.calls().filter((c) => !c.includes('Service')), [`New-Partition max=False size=${270 * GB} letter=W`, 'Format-Volume W NTFS Wikivault']);
  } finally { await f.done(); }
});

test('create: refuses a full MBR disk and a non-NTFS drive', { skip }, async () => {
  const mbr = await fixture({ style: 'MBR', partitionCount: 4 });
  try {
    await assert.rejects(mbr.tool.create('C', 270 * GB), /already has four partitions/);
    assert.deepEqual(mbr.calls(), []);
  } finally { await mbr.done(); }
  const fat = await fixture({ fs: 'FAT32' });
  try {
    await assert.rejects(fat.tool.create('C', 270 * GB), /is not NTFS/);
    assert.deepEqual(fat.calls(), []);
  } finally { await fat.done(); }
});

test('create: rejects bad input before anything runs', async () => {
  const tool = new PartitionTool({ shell: '/nonexistent' });
  await assert.rejects(tool.create('c:', 270 * GB), /drive letter is not valid/);
  await assert.rejects(tool.create('C', 12.5), /size is not valid/);
  await assert.rejects(tool.create('C', 1000), /size is not valid/);
});

// ---- merging the partition back ----

async function mergeFixture(over = {}, files = []) {
  const f = await fixture({
    partitionSize: 793 * GB, cOffset: 1 * GB, volFree: 540 * GB, sizeMin: 300 * GB, usedLetters: ['C', 'W'],
    other: { letter: 'W', size: 160 * GB, offset: 794 * GB, label: 'Wikivault', disk: 0, isSystem: false, isBoot: false, root: '', ...over },
  });
  const root = path.join(path.dirname(process.env.PART_MOCK_STATE), 'W-root');
  for (const d of ['System Volume Information', '$RECYCLE.BIN', path.join('Wikivault', 'zim'), path.join('Wikivault', 'downloads')]) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'x'); }
  const state = JSON.parse(fs.readFileSync(process.env.PART_MOCK_STATE, 'utf8'));
  state.other.root = root;
  fs.writeFileSync(process.env.PART_MOCK_STATE, JSON.stringify(state));
  return f;
}

test('inspect: an emptied Wikivault partition directly after C: is safe to merge', { skip }, async () => {
  const f = await mergeFixture();
  try {
    const r = await f.tool.inspect('C', 'W');
    assert.equal(r.exists, true);
    assert.equal(r.mergeable, true);
    assert.deepEqual(r.problems, []);
    assert.equal(r.label, 'Wikivault');
    assert.equal(r.otherSize, 160 * GB);
    assert.deepEqual(f.calls(), []);
    const gone = await f.tool.inspect('C', 'Q');
    assert.equal(gone.exists, false);
  } finally { await f.done(); }
});

test('merge: removes the Wikivault partition and extends C: over it', { skip }, async () => {
  const f = await mergeFixture();
  try {
    const r = await f.tool.merge('C', 'W');
    assert.equal(r.ok, true);
    assert.equal(r.extended, true);
    assert.equal(r.removedBytes, 160 * GB);
    assert.equal(r.sourceSizeBefore, 793 * GB);
    assert.equal(r.sourceSizeAfter, 953 * GB);
    assert.deepEqual(f.calls(), ['Remove-Partition W', `Resize-Partition C ${953 * GB}`]);
  } finally { await f.done(); }
});

const UNSAFE = [
  ['a partition with a different name', { label: 'Data' }, [], /is named "Data", not "Wikivault"/],
  ['a partition on another disk', { disk: 1 }, [], /is on a different disk/],
  ['a partition that is not directly after C:', { offset: 900 * GB }, [], /is not directly after C:/],
  ['a Windows boot partition', { isBoot: true }, [], /system or boot partition/],
  ['a partition that still holds the library', {}, [path.join('Wikivault', 'zim', 'wikipedia_en_all_maxi_2026-10.zim')], /still contains 1 item\(s\) that would be lost: Wikivault.zim.wikipedia_en_all_maxi_2026-10\.zim/],
  ['a partition with other files on it', {}, [path.join('Photos', 'a.jpg'), 'notes.txt'], /still contains 2 item\(s\) that would be lost: (Photos, notes\.txt|notes\.txt, Photos)/],
];
for (const [name, over, files, re] of UNSAFE) {
  test(`merge refuses ${name}, and changes nothing`, { skip }, async () => {
    const f = await mergeFixture(over, files);
    try {
      const seen = await f.tool.inspect('C', 'W');
      assert.equal(seen.mergeable, false);
      assert.match(seen.problems.join(' '), re);
      await assert.rejects(f.tool.merge('C', 'W'), (e) => {
        assert.equal(e.code, 'NOT_SAFE');
        assert.match(e.message, /^Nothing was changed\./);
        assert.match(e.message, re);
        return true;
      });
      assert.deepEqual(f.calls(), []);
      assert.equal(f.disk().other.letter, 'W');
    } finally { await f.done(); }
  });
}

test('merge: does nothing without administrator rights or when approval is declined', { skip }, async () => {
  const f = await mergeFixture();
  try {
    const state = f.disk(); state.elevated = false; fs.writeFileSync(process.env.PART_MOCK_STATE, JSON.stringify(state));
    await assert.rejects(f.tool.merge('C', 'W'), /needs administrator approval/);
    state.elevated = true; fs.writeFileSync(process.env.PART_MOCK_STATE, JSON.stringify(state));
    process.env.FAKE_UAC = 'decline';
    await assert.rejects(f.tool.merge('C', 'W'), (e) => e.code === 'DECLINED');
    assert.deepEqual(f.calls(), []);
  } finally { delete process.env.FAKE_UAC; await f.done(); }
});

test('merge: if C: cannot be extended afterwards, it says exactly what state the disk is in', { skip }, async () => {
  const f = await mergeFixture();
  try {
    const state = f.disk(); state.failResize = true; fs.writeFileSync(process.env.PART_MOCK_STATE, JSON.stringify(state));
    const r = await f.tool.merge('C', 'W');
    assert.equal(r.extended, false);
    assert.match(r.warning, /W: was removed, but C: could not be extended automatically.*Extend Volume/);
    assert.equal(r.sourceSizeAfter, 793 * GB);
  } finally { await f.done(); }
});

test('merge: rejects bad letters before anything runs', async () => {
  const tool = new PartitionTool({ shell: '/nonexistent' });
  await assert.rejects(tool.merge('C', 'C'), /drive letters are not valid/);
  await assert.rejects(tool.merge('C', 'w:'), /drive letters are not valid/);
});

test('other libraries on the same partition raise the smallest and the recommended size', () => {
  const base = { editionBytes: 115 * GB, volumeFree: 800 * GB, partitionSize: 953 * GB, sizeMin: 200 * GB, editions: 1 };
  const plain = sizePlan(base);
  assert.equal(plain.otherBytes, 0);
  // Nothing downloaded yet: the smallest size is unchanged, the recommendation leaves room for them.
  const roomy = sizePlan({ ...base, otherAllowance: 21 * GB });
  assert.equal(roomy.minBytes, plain.minBytes);
  assert.equal(roomy.recommendedBytes, plain.recommendedBytes + 20 * GB);
  assert.equal(roomy.otherBytes, 21 * GB);
  // 8 GB of them already downloaded: they have to fit, and need as much again while one is updated.
  const have = sizePlan({ ...base, otherBytes: 8 * GB, otherAllowance: 10 * GB });
  assert.equal(have.minBytes, plain.minBytes + 8 * GB);
  assert.equal(have.otherBytes, 16 * GB);
});

test('a plan is limited to what the drive can give up at the moment it is shrunk', () => {
  const { capPlan } = require('../src/core/partition');
  const plan = sizePlan({ editionBytes: 115 * GB, volumeFree: 900 * GB, partitionSize: 953 * GB, sizeMin: null, editions: 1, otherBytes: 40 * GB });
  assert.ok(plan.feasible && plan.maxBytes > 300 * GB);
  // The library is sitting on the drive while it is shrunk, so less can be given than will be free in the end.
  const capped = capPlan(plan, 250.7 * GB, 'C');
  assert.deepEqual([capped.maxBytes, capped.feasible, capped.reason], [250 * GB, true, null]);
  assert.ok(capped.recommendedBytes <= 250 * GB && capped.recommendedBytes >= capped.minBytes);
  const none = capPlan(plan, 100 * GB, 'C');
  assert.deepEqual([none.feasible, none.recommendedBytes, none.maxBytes], [false, null, 100 * GB]);
  assert.match(none.reason, /needs at least \d+ GB, and drive C: can give up 100 GB at the moment/);
  assert.equal(capPlan(plan, 5000 * GB).maxBytes, plan.maxBytes, 'a cap above the plan changes nothing');
  assert.equal(capPlan(plan, -5 * GB).maxBytes, 0);
});
