param([Parameter(Mandatory=$true)][string]$RunRoot,[string]$Label='regression',[string]$Filter='popup transitions|workspace scroll|entrance continuation|saved visit|account identity|administration shared|reservation endpoint|explicit expiry|coordinated motion')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$run=[IO.Path]::GetFullPath((Join-Path $projectRoot $RunRoot))
$allowed=[IO.Path]::GetFullPath((Join-Path $projectRoot 'docs\evidence'))+[IO.Path]::DirectorySeparatorChar
if (-not $run.StartsWith($allowed) -or -not (Test-Path -LiteralPath (Join-Path $run 'run.json'))) { throw 'Unique evidence run required.' }
if ($Label -notmatch '^[a-z0-9-]+$') { throw 'Invalid label.' }
$capture=Join-Path $run ($Label+'-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
if (Test-Path -LiteralPath $capture) { throw 'Refusing evidence overwrite.' }
[IO.Directory]::CreateDirectory($capture) | Out-Null
$stream=[IO.File]::Open((Join-Path $capture 'capture-run.json'),[IO.FileMode]::CreateNew)
try { $bytes=[Text.Encoding]::UTF8.GetBytes('{"kind":"Final genuine-key server; controlled UI checks do not establish genuine provider acceptance"}');$stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
$env:PALMSTEEZE_CAPTURE_ROOT=$capture
$env:PALMSTEEZE_TARGETED_CONTROLLED='true'
Write-Output ('Unique capture directory: '+$capture)
$arguments=@('exec','--','playwright','test','--config=playwright.stabilization.config.ts','--grep',$Filter)
& (Join-Path $PSScriptRoot 'npm.ps1') @arguments
exit $LASTEXITCODE
