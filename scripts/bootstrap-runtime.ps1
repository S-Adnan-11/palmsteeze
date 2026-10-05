$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeVersion = '24.21.0'
$runtimeFolder = Join-Path $projectRoot ".tools\node-v$runtimeVersion-win-x64"
if ((Test-Path -LiteralPath (Join-Path $runtimeFolder 'node.exe')) -and
    (Test-Path -LiteralPath (Join-Path $runtimeFolder 'node_modules\npm\lib\cli.js'))) {
    & (Join-Path $runtimeFolder 'node.exe') --version
    exit $LASTEXITCODE
}
$toolsFolder = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Path $toolsFolder -Force | Out-Null
$archiveName = "node-v$runtimeVersion-win-x64.zip"
$archivePath = Join-Path $toolsFolder $archiveName
$manifestPath = Join-Path $toolsFolder "SHASUMS256-v$runtimeVersion.txt"
Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$runtimeVersion/SHASUMS256.txt" -OutFile $manifestPath
Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$runtimeVersion/$archiveName" -OutFile $archivePath
$line = Get-Content -LiteralPath $manifestPath | Where-Object { $_ -match "  $([regex]::Escape($archiveName))$" }
if (-not $line) { throw 'Official checksum missing' }
$expectedHash = ($line -split '\s+')[0]
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw 'Runtime checksum mismatch; archive not extracted' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsFolder -Force
Write-Output 'Official Node archive SHA-256 verified; isolated runtime ready.'
& (Join-Path $runtimeFolder 'node.exe') --version
