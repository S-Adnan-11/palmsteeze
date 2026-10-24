$ErrorActionPreference = 'Stop'
$palmProjectRoot = Split-Path -Parent $PSScriptRoot
$palmRuntimeFolder = Join-Path $palmProjectRoot '.tools\node-v24.21.0-win-x64'
$palmRuntimeExecutable = Join-Path $palmRuntimeFolder 'node.exe'
if (-not (Test-Path -LiteralPath $palmRuntimeExecutable)) { throw 'Run scripts/bootstrap-runtime.ps1 first.' }
$env:PATH = "$palmRuntimeFolder;$env:PATH"
$env:NPM_CONFIG_CACHE = Join-Path $palmProjectRoot '.npm-cache'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:VERCEL_TELEMETRY_DISABLED = '1'
$env:DO_NOT_TRACK = '1'
Push-Location $palmProjectRoot
try {
    # Registry metadata checked 5 October 2026: Node >=20, Apache-2.0.
    # Project-local cache; no global installation or automatic deployment.
    & $palmRuntimeExecutable (Join-Path $palmRuntimeFolder 'node_modules\npm\bin\npx-cli.js') --yes --package=vercel@62.2.0 vercel @args
    exit $LASTEXITCODE
} finally { Pop-Location }
