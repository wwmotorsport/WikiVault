# Wikivault partition helper (Windows PowerShell 5.1 compatible).
#
# Reads params.json from its own folder and writes result.json there.
#   { "mode": "analyze", "driveLetter": "C" }
#   { "mode": "create",  "driveLetter": "C", "sizeBytes": 289910292480, "label": "Wikivault" }
#
#   { "mode": "inspect", "driveLetter": "C", "otherLetter": "W", "label": "Wikivault" }
#   { "mode": "merge",   "driveLetter": "C", "otherLetter": "W", "label": "Wikivault" }
#
# "analyze" and "inspect" only read. "create" shrinks the given volume and makes
# a new NTFS volume in the space that frees up. "merge" undoes that: it removes
# the Wikivault volume and extends the original volume over the space.
#
# Safety rules this script keeps to:
#   - create never deletes or formats an existing partition;
#   - create refuses if Windows says the volume cannot shrink that far;
#   - if the new partition cannot be created after the shrink, the original
#     volume is extended back to its previous size;
#   - merge is the only place a partition is removed, and it refuses unless the
#     volume carries the expected label, sits on the same disk directly after
#     the volume it will be merged into, is not a Windows system or boot
#     partition, and holds no files other than an empty Wikivault folder.

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$paramsPath = Join-Path $here 'params.json'
$resultPath = Join-Path $here 'result.json'
$logPath = Join-Path $here 'steps.log'

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Depth 6 -Compress
  [System.IO.File]::WriteAllText($resultPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Write-Step([string]$text) {
  $line = (Get-Date).ToString('s') + ' ' + $text
  [System.IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine)
}

# Tests supply their own version of this function before running the script.
if (-not (Get-Command Test-WikivaultElevated -ErrorAction SilentlyContinue)) {
  function Test-WikivaultElevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  }
}

# Tests point this at a scratch folder; on Windows it is simply "W:\".
if (-not (Get-Command Get-WikivaultRoot -ErrorAction SilentlyContinue)) {
  function Get-WikivaultRoot([string]$driveLetter) { return ($driveLetter + ':\') }
}

# Everything on the volume that is not part of an emptied Wikivault library.
function Get-Leftovers([string]$root) {
  $allowed = @('System Volume Information', '$RECYCLE.BIN', 'Wikivault')
  $left = @()
  foreach ($item in @(Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue)) {
    if ($allowed -notcontains $item.Name) { $left += [string]$item.Name }
  }
  $inner = Join-Path $root 'Wikivault'
  if (Test-Path -LiteralPath $inner) {
    foreach ($f in @(Get-ChildItem -LiteralPath $inner -Recurse -Force -File -ErrorAction SilentlyContinue)) {
      $left += ('Wikivault' + $f.FullName.Substring($inner.Length))
    }
  }
  return $left
}

function Get-FreeLetter {
  $used = @()
  try { $used += @(Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object { ([string]$_.DriveLetter).ToUpper() }) } catch { }
  try { $used += @(Get-PSDrive -PSProvider FileSystem | ForEach-Object { ([string]$_.Name).ToUpper() }) } catch { }
  foreach ($c in 'W','V','X','Y','Z','U','T','S','R','Q','P','O','N','M','L','K','J','I','H','G','F','E','D') {
    if ($used -notcontains $c) { return $c }
  }
  return $null
}

function Get-BitLockerState([string]$letter) {
  try {
    $bl = Get-BitLockerVolume -MountPoint ($letter + ':')
    if ([string]$bl.VolumeStatus -eq 'FullyDecrypted') { return 'Off' }
    return 'On'
  } catch { }
  try {
    # Readable without administrator rights: 1/3/5 = protected or encrypting, 2 = off.
    $v = (New-Object -ComObject Shell.Application).NameSpace($letter + ':').Self.ExtendedProperty('System.Volume.BitLockerProtection')
    if ($v -eq 1 -or $v -eq 3 -or $v -eq 5) { return 'On' }
    if ($v -eq 2) { return 'Off' }
  } catch { }
  return 'Unknown'
}

try {
  $p = Get-Content -LiteralPath $paramsPath -Raw | ConvertFrom-Json
  $mode = [string]$p.mode
  $letter = ([string]$p.driveLetter).ToUpper()
  if ($letter -notmatch '^[A-Z]$') { throw 'The drive letter is not valid.' }

  $part = Get-Partition -DriveLetter $letter
  $disk = Get-Disk -Number $part.DiskNumber
  $vol = Get-Volume -DriveLetter $letter

  $sizeMin = $null
  $sizeMax = $null
  try {
    $sup = Get-PartitionSupportedSize -DriveLetter $letter
    $sizeMin = [UInt64]$sup.SizeMin
    $sizeMax = [UInt64]$sup.SizeMax
  } catch { }

  $elevated = $false
  try { $elevated = [bool](Test-WikivaultElevated) } catch { }

  $info = [ordered]@{
    ok = $true
    mode = $mode
    driveLetter = $letter
    diskNumber = [int]$disk.Number
    partitionStyle = [string]$disk.PartitionStyle
    partitionSize = [UInt64]$part.Size
    sizeMin = $sizeMin
    sizeMax = $sizeMax
    volumeSize = [UInt64]$vol.Size
    volumeFree = [UInt64]$vol.SizeRemaining
    fileSystem = [string]$vol.FileSystem
    largestFreeExtent = [UInt64]$disk.LargestFreeExtent
    bitLocker = (Get-BitLockerState $letter)
    freeLetter = (Get-FreeLetter)
    elevated = $elevated
  }

  if ($mode -eq 'analyze') {
    Write-Result $info
    exit 0
  }

  # ---- inspect / merge ---------------------------------------------------
  if ($mode -eq 'inspect' -or $mode -eq 'merge') {
    $other = ([string]$p.otherLetter).ToUpper()
    if ($other -notmatch '^[A-Z]$') { throw 'The partition letter is not valid.' }
    $wantLabel = [string]$p.label
    if (-not $wantLabel) { $wantLabel = 'Wikivault' }

    $o = $null
    $ov = $null
    try { $o = Get-Partition -DriveLetter $other; $ov = Get-Volume -DriveLetter $other } catch { }
    if ($null -eq $o -or $null -eq $ov) {
      if ($mode -eq 'inspect') {
        Write-Result ([ordered]@{ ok = $true; mode = 'inspect'; exists = $false; otherLetter = $other; driveLetter = $letter })
        exit 0
      }
      throw ('Drive ' + $other + ': was not found.')
    }

    $problems = @()
    $systemLetter = ''
    if ($env:SystemDrive) { $systemLetter = ([string]$env:SystemDrive).Substring(0, 1).ToUpper() }
    if ($other -eq $letter -or $other -eq $systemLetter) { $problems += ('Drive ' + $other + ': is the Windows drive.') }
    if ([bool]$o.IsSystem -or [bool]$o.IsBoot) { $problems += ('Drive ' + $other + ': is a Windows system or boot partition.') }
    if ([string]$ov.FileSystemLabel -ne $wantLabel) { $problems += ('Drive ' + $other + ': is named "' + [string]$ov.FileSystemLabel + '", not "' + $wantLabel + '", so it does not look like the partition Wikivault created.') }
    if ([int]$o.DiskNumber -ne [int]$part.DiskNumber) { $problems += ('Drive ' + $other + ': is on a different disk from ' + $letter + ':.') }
    $gap = [Int64]$o.Offset - ([Int64]$part.Offset + [Int64]$part.Size)
    if ($gap -lt 0 -or $gap -gt 67108864) { $problems += ('Drive ' + $other + ': is not directly after ' + $letter + ': on the disk, so its space could not be added back to ' + $letter + ':.') }
    $leftovers = @(Get-Leftovers (Get-WikivaultRoot $other))
    if ($leftovers.Count -gt 0) {
      $shown = ($leftovers | Select-Object -First 5) -join ', '
      $problems += ('Drive ' + $other + ': still contains ' + $leftovers.Count + ' item(s) that would be lost: ' + $shown + '.')
    }

    if ($mode -eq 'inspect') {
      Write-Result ([ordered]@{
        ok = $true
        mode = 'inspect'
        exists = $true
        otherLetter = $other
        driveLetter = $letter
        label = [string]$ov.FileSystemLabel
        otherSize = [UInt64]$o.Size
        partitionSize = [UInt64]$part.Size
        volumeFree = [UInt64]$vol.SizeRemaining
        leftovers = @($leftovers | Select-Object -First 20)
        problems = @($problems)
        mergeable = ($problems.Count -eq 0)
      })
      exit 0
    }

    if (-not $elevated) { throw 'Removing a partition needs administrator approval.' }
    if ($problems.Count -gt 0) {
      Write-Result ([ordered]@{ ok = $false; code = 'NOT_SAFE'; problems = @($problems); error = ('Nothing was changed. ' + ($problems -join ' ')) })
      exit 3
    }

    $before = [UInt64]$part.Size
    $removedBytes = [UInt64]$o.Size
    Write-Step ('removing partition ' + $other + ': (' + $removedBytes + ' bytes, label ' + $wantLabel + ')')
    Remove-Partition -DriveLetter $other -Confirm:$false

    $extended = $false
    $extendError = ''
    try {
      $again = Get-PartitionSupportedSize -DriveLetter $letter
      if ([UInt64]$again.SizeMax -gt $before) {
        Write-Step ('extending ' + $letter + ': to ' + [UInt64]$again.SizeMax)
        Resize-Partition -DriveLetter $letter -Size ([UInt64]$again.SizeMax)
        $extended = $true
      } else {
        $extendError = 'Windows reported no extra space to add.'
      }
    } catch { $extendError = [string]$_.Exception.Message }

    $after = Get-Partition -DriveLetter $letter
    Write-Step 'done'
    $result = [ordered]@{
      ok = $true
      mode = 'merge'
      removedLetter = $other
      removedBytes = $removedBytes
      extended = $extended
      sourceLetter = $letter
      sourceSizeBefore = $before
      sourceSizeAfter = [UInt64]$after.Size
    }
    if (-not $extended) {
      $result.warning = ('Drive ' + $other + ': was removed, but ' + $letter + ': could not be extended automatically (' + $extendError + '). The space is unallocated: open Disk Management, right-click ' + $letter + ': and choose Extend Volume.')
    }
    Write-Result $result
    exit 0
  }

  if ($mode -ne 'create') { throw 'Unknown mode.' }

  # ---- create ------------------------------------------------------------
  if (-not $elevated) { throw 'Creating a partition needs administrator approval.' }
  if ([string]$vol.FileSystem -ne 'NTFS') { throw ('Drive ' + $letter + ': is not NTFS, so Windows cannot shrink it.') }

  $mb = [UInt64]1048576
  $requested = [UInt64]$p.sizeBytes
  $newBytes = [UInt64]($requested - ($requested % $mb))
  if ($newBytes -lt ([UInt64]1073741824)) { throw 'The requested partition size is too small.' }

  $label = [string]$p.label
  if ($label -notmatch '^[A-Za-z0-9 _-]{1,24}$') { $label = 'Wikivault' }

  $newLetter = $info.freeLetter
  if (-not $newLetter) { throw 'No drive letter is free for the new partition.' }

  if ([string]$disk.PartitionStyle -eq 'MBR') {
    $count = @(Get-Partition -DiskNumber $disk.Number).Count
    if ($count -ge 4) { throw 'This disk uses the older MBR layout and already has four partitions, so another cannot be added.' }
  }

  $originalSize = [UInt64]$part.Size
  $needShrink = ([UInt64]$disk.LargestFreeExtent) -lt $newBytes

  if ($needShrink) {
    if ($null -eq $sizeMin) { throw ('Windows could not report how far drive ' + $letter + ': can be shrunk.') }
    $maxShrink = [UInt64]0
    if ($originalSize -gt $sizeMin) { $maxShrink = [UInt64]($originalSize - $sizeMin) }
    if ($newBytes -gt $maxShrink) {
      Write-Result ([ordered]@{
        ok = $false
        code = 'TOO_LARGE'
        maxBytes = $maxShrink
        error = ('Windows can shrink drive ' + $letter + ': by at most ' + [Math]::Floor($maxShrink / 1073741824) + ' GB right now, because some system files cannot be moved.')
      })
      exit 2
    }
  }

  # Stops Explorer from popping up "You need to format the disk" while we work.
  $shellStopped = $false
  try { Stop-Service -Name ShellHWDetection -Force; $shellStopped = $true } catch { }

  $shrunk = $false
  try {
    if ($needShrink) {
      $target = [UInt64]($originalSize - $newBytes)
      Write-Step ('shrinking ' + $letter + ': from ' + $originalSize + ' to ' + $target)
      Resize-Partition -DriveLetter $letter -Size $target
      $shrunk = $true
    }

    try {
      Write-Step ('creating partition ' + $newLetter + ':')
      if ($needShrink) {
        # The gap just opened is now the largest free region on the disk.
        New-Partition -DiskNumber $disk.Number -UseMaximumSize -DriveLetter $newLetter | Out-Null
      } else {
        New-Partition -DiskNumber $disk.Number -Size $newBytes -DriveLetter $newLetter | Out-Null
      }
    } catch {
      $why = $_.Exception.Message
      $restored = $false
      if ($shrunk) {
        try {
          Write-Step ('create failed, extending ' + $letter + ': back')
          $again = Get-PartitionSupportedSize -DriveLetter $letter
          Resize-Partition -DriveLetter $letter -Size ([UInt64]$again.SizeMax)
          $restored = $true
        } catch { }
      }
      $msg = 'The new partition could not be created: ' + $why
      if ($restored) { $msg += ' Drive ' + $letter + ': was returned to its original size.' }
      elseif ($shrunk) { $msg += ' Drive ' + $letter + ': was shrunk and the space is now unallocated. Open Disk Management, right-click ' + $letter + ': and choose Extend Volume to get it back.' }
      Write-Result ([ordered]@{ ok = $false; code = 'CREATE_FAILED'; restored = $restored; error = $msg })
      exit 1
    }

    try {
      Write-Step ('formatting ' + $newLetter + ':')
      Format-Volume -DriveLetter $newLetter -FileSystem NTFS -NewFileSystemLabel $label -Confirm:$false | Out-Null
    } catch {
      Write-Result ([ordered]@{
        ok = $false
        code = 'FORMAT_FAILED'
        driveLetter = $newLetter
        error = ('The partition was created as ' + $newLetter + ': but Windows could not format it (' + $_.Exception.Message + '). Open Disk Management, right-click the new partition and choose Format, then pick it with Change folder.')
      })
      exit 1
    }
  } finally {
    if ($shellStopped) { try { Start-Service -Name ShellHWDetection } catch { } }
  }

  $created = Get-Partition -DriveLetter $newLetter
  $after = Get-Partition -DriveLetter $letter
  Write-Step 'done'
  Write-Result ([ordered]@{
    ok = $true
    mode = 'create'
    driveLetter = $newLetter
    sizeBytes = [UInt64]$created.Size
    label = $label
    shrunk = $needShrink
    sourceLetter = $letter
    sourceSizeBefore = $originalSize
    sourceSizeAfter = [UInt64]$after.Size
  })
  exit 0
} catch {
  try { Write-Step ('error: ' + $_.Exception.Message) } catch { }
  Write-Result ([ordered]@{ ok = $false; code = 'ERROR'; error = [string]$_.Exception.Message })
  exit 1
}
