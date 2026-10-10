param([Parameter(Mandatory=$true)][string]$RunRoot,[string]$Label='focused',[string]$Filter='',[int]$Workers=1)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$resolvedRun=[IO.Path]::GetFullPath((Join-Path $projectRoot $RunRoot))
$allowedRoot=[IO.Path]::GetFullPath((Join-Path $projectRoot 'docs\evidence'))+[IO.Path]::DirectorySeparatorChar
if (-not $resolvedRun.StartsWith($allowedRoot) -or -not (Test-Path -LiteralPath (Join-Path $resolvedRun 'run.json'))) { throw 'New evidence run marker required.' }
if ($Label -notmatch '^[a-z0-9-]+$') { throw 'Invalid capture label.' }
$captureRoot=Join-Path $resolvedRun ($Label+'-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
if (Test-Path -LiteralPath $captureRoot) { throw 'Refusing to overwrite a capture directory.' }
[IO.Directory]::CreateDirectory($captureRoot) | Out-Null
$marker=Join-Path $captureRoot 'capture-run.json'
$stream=[IO.File]::Open($marker,[IO.FileMode]::CreateNew)
try { $bytes=[Text.Encoding]::UTF8.GetBytes('{"reserved":true}');$stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
$env:PALMSTEEZE_CAPTURE_ROOT=$captureRoot
Write-Output ('New capture directory: '+$captureRoot)
$arguments=@('exec','--','playwright','test','--config=playwright.targeted.config.ts',('--workers='+$Workers))
if ($Filter) { $arguments+=@('--grep',$Filter) }
& (Join-Path $PSScriptRoot 'npm.ps1') @arguments
exit $LASTEXITCODE
