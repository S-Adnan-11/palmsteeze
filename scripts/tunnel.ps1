param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeExecutable = Join-Path $projectRoot '.tools\node-v24.21.0-win-x64\node.exe'
$tunnelExecutable = Join-Path $projectRoot '.tools\devtunnel\devtunnel.exe'
if (-not (Test-Path -LiteralPath $runtimeExecutable)) { throw 'Run scripts/bootstrap-runtime.ps1 first.' }
if (-not (Test-Path -LiteralPath $tunnelExecutable)) { throw 'Install the signed development tunnel CLI under .tools/devtunnel/ before using this wrapper.' }
Push-Location $projectRoot
try {
  $operation = if ($CheckOnly) { '--check' } else { '--repair' }
  $result = & $runtimeExecutable (Join-Path $projectRoot 'node_modules\tsx\dist\cli.mjs') scripts/development-tunnel.ts $operation
  if ($LASTEXITCODE -ne 0) { throw 'Development tunnel checks failed; hostname and access policy were not replaced.' }
  $state = $result | ConvertFrom-Json
  Write-Host "Host/Origin forwarding verified: $($state.origin)"
  if ($state.hostConnected) {
    Write-Host 'The existing tunnel host is connected; authenticated HTTPS checks passed. Keep that host running.'
  } elseif ($CheckOnly) {
    Write-Host 'The existing host is disconnected. Run ./scripts/tunnel.ps1 to reconnect it.'
  } else {
    Write-Host 'Reconnecting the same existing tunnel. Keep this terminal open; Ctrl+C stops this relay.'
    & $tunnelExecutable host $state.tunnelId
    if ($LASTEXITCODE -ne 0) { throw 'The existing development tunnel host stopped with an error.' }
  }
} finally { Pop-Location }
