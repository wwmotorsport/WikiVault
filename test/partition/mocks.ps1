# Stand-ins for the Windows Storage cmdlets, driven by a JSON "disk" so the real
# partition.ps1 can be exercised on any machine without touching a disk.

function Get-State { Get-Content -LiteralPath $env:PART_MOCK_STATE -Raw | ConvertFrom-Json }
function Set-State($s) { $s | ConvertTo-Json | Set-Content -LiteralPath $env:PART_MOCK_STATE }
function Log-Call([string]$t) { Add-Content -LiteralPath $env:PART_MOCK_CALLS -Value $t }

function Test-WikivaultElevated { [bool](Get-State).elevated }
function Get-WikivaultRoot([string]$driveLetter) { [string](Get-State).other.root }

function Get-Partition {
  param([string]$DriveLetter, [int]$DiskNumber = -1)
  $s = Get-State
  if ($DriveLetter) {
    if ($DriveLetter -eq 'C') { return [pscustomobject]@{ DiskNumber = 0; Size = [UInt64]$s.partitionSize; Offset = [UInt64]$s.cOffset; DriveLetter = 'C'; IsSystem = $false; IsBoot = $true } }
    if ($s.other -and $DriveLetter -eq $s.other.letter) { return [pscustomobject]@{ DiskNumber = [int]$s.other.disk; Size = [UInt64]$s.other.size; Offset = [UInt64]$s.other.offset; DriveLetter = $s.other.letter; IsSystem = [bool]$s.other.isSystem; IsBoot = [bool]$s.other.isBoot } }
    if ($s.newLetter -and $DriveLetter -eq $s.newLetter) { return [pscustomobject]@{ DiskNumber = 0; Size = [UInt64]$s.newSize; DriveLetter = $s.newLetter } }
    throw "No MSFT_Partition objects found with property 'DriveLetter' equal to '$DriveLetter'."
  }
  return @(1..[int]$s.partitionCount | ForEach-Object { [pscustomobject]@{ DiskNumber = 0 } })
}
function Get-Disk { param([int]$Number) $s = Get-State; [pscustomobject]@{ Number = 0; PartitionStyle = $s.style; LargestFreeExtent = [UInt64]$s.largestFreeExtent } }
function Get-Volume {
  param([string]$DriveLetter)
  $s = Get-State
  if ($DriveLetter -and $s.other -and $DriveLetter -eq $s.other.letter) { return [pscustomobject]@{ DriveLetter = $s.other.letter; Size = [UInt64]$s.other.size; SizeRemaining = [UInt64]$s.other.size; FileSystem = 'NTFS'; FileSystemLabel = [string]$s.other.label } }
  if ($DriveLetter -and $DriveLetter -ne 'C') { throw "No MSFT_Volume objects found with property 'DriveLetter' equal to '$DriveLetter'." }
  if ($DriveLetter) { return [pscustomobject]@{ DriveLetter = 'C'; Size = [UInt64]$s.partitionSize; SizeRemaining = [UInt64]$s.volFree; FileSystem = $s.fs; FileSystemLabel = 'OS' } }
  return @($s.usedLetters | ForEach-Object { [pscustomobject]@{ DriveLetter = $_ } })
}
function Get-PSDrive { param($PSProvider) @() }
function Get-PartitionSupportedSize {
  param([string]$DriveLetter)
  $s = Get-State
  if ($s.supportedFails) { throw 'Access denied' }
  [pscustomobject]@{ SizeMin = [UInt64]$s.sizeMin; SizeMax = [UInt64]([UInt64]$s.partitionSize + [UInt64]$s.largestFreeExtent) }
}
function Get-BitLockerVolume { param($MountPoint) $s = Get-State; if (-not $s.bitlocker) { throw 'Access denied' }; [pscustomobject]@{ VolumeStatus = $s.bitlocker } }
function Resize-Partition {
  param([string]$DriveLetter, [UInt64]$Size)
  Log-Call "Resize-Partition $DriveLetter $Size"
  $s = Get-State
  if ($s.failResize) { throw 'The volume cannot be shrunk because of unmovable files.' }
  $delta = [Int64]$s.partitionSize - [Int64]$Size
  $s.partitionSize = $Size
  $s.largestFreeExtent = [UInt64]([Int64]$s.largestFreeExtent + $delta)
  Set-State $s
}
function New-Partition {
  param([int]$DiskNumber, [switch]$UseMaximumSize, [UInt64]$Size, [string]$DriveLetter)
  Log-Call "New-Partition max=$($UseMaximumSize.IsPresent) size=$Size letter=$DriveLetter"
  $s = Get-State
  if ($s.failNew) { throw 'Not enough available capacity' }
  $sz = $Size
  if ($UseMaximumSize) { $sz = [UInt64]$s.largestFreeExtent }
  $s | Add-Member -Force -NotePropertyName newLetter -NotePropertyValue $DriveLetter
  $s | Add-Member -Force -NotePropertyName newSize -NotePropertyValue $sz
  $s.largestFreeExtent = [UInt64]([UInt64]$s.largestFreeExtent - $sz)
  Set-State $s
  [pscustomobject]@{ DriveLetter = $DriveLetter }
}
function Format-Volume {
  param([string]$DriveLetter, [string]$FileSystem, [string]$NewFileSystemLabel, [switch]$Confirm)
  Log-Call "Format-Volume $DriveLetter $FileSystem $NewFileSystemLabel"
  if ((Get-State).failFormat) { throw 'The format did not complete' }
}
function Stop-Service { param($Name, [switch]$Force) Log-Call "Stop-Service $Name" }
function Start-Service { param($Name) Log-Call "Start-Service $Name" }
function Remove-Partition {
  param([string]$DriveLetter, [switch]$Confirm)
  Log-Call "Remove-Partition $DriveLetter"
  $s = Get-State
  if ($s.failRemove) { throw 'The partition is in use.' }
  $s.largestFreeExtent = [UInt64]([UInt64]$s.largestFreeExtent + [UInt64]$s.other.size)
  $s.other = $null
  Set-State $s
}
