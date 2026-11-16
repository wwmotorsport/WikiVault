param([string]$Script)
. (Join-Path $PSScriptRoot 'mocks.ps1')
& $Script
exit $LASTEXITCODE
