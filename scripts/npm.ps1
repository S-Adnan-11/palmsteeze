$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeFolder = Join-Path $projectRoot '.tools\node-v24.21.0-win-x64'
$runtimeExecutable = Join-Path $runtimeFolder 'node.exe'
if (-not (Test-Path -LiteralPath $runtimeExecutable)) { throw 'Run scripts/bootstrap-runtime.ps1 first.' }
$env:PATH = "$runtimeFolder;$env:PATH"
$env:NPM_CONFIG_CACHE = Join-Path $projectRoot '.npm-cache'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.playwright'
Push-Location $projectRoot
try {
    & $runtimeExecutable (Join-Path $runtimeFolder 'node_modules\npm\bin\npm-cli.js') @args
    exit $LASTEXITCODE
} finally { Pop-Location }
