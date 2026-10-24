$ErrorActionPreference='Stop'
$palmRoot=Split-Path -Parent $PSScriptRoot
Push-Location $palmRoot
try {
  $palmRevision=(& git rev-parse HEAD).Trim()
  if($LASTEXITCODE -ne 0 -or $palmRevision -notmatch '^[a-f0-9]{40}$'){throw 'Cannot identify committed release.'}
  & git diff --quiet HEAD -- src public scripts supabase package.json package-lock.json next.config.ts vercel.json .vercelignore
  if($LASTEXITCODE -ne 0){throw 'Commit reviewed deployment inputs before packaging.'}
  $palmTracked=@(& git ls-tree -r --name-only HEAD)
  $palmForbidden=@($palmTracked | Where-Object { $_ -match '^(docs/|reviews/|project-guides/|palmsteeze-private/|\.tools/|\.env(?!\.example$))|(^|/)(brief_master|full_master|brief_agent|full_agent)\.md$' })
  if($palmForbidden.Count){throw 'Private content found in committed archive; inspect locally.'}
  $palmRelease=Join-Path $palmRoot ".tools\releases\$palmRevision"
  $palmArchive=Join-Path $palmRoot ".tools\releases\$palmRevision.zip"
  if(Test-Path -LiteralPath $palmRelease){throw 'Release destination already exists; preserve it.'}
  New-Item -ItemType Directory -Path (Split-Path -Parent $palmArchive) -Force | Out-Null
  & git archive --format=zip --output=$palmArchive HEAD
  if($LASTEXITCODE -ne 0){throw 'Git archive failed.'}
  Expand-Archive -LiteralPath $palmArchive -DestinationPath $palmRelease
  # CLI upload is deliberately made from the commit archive, never the working
  # tree: .vercelignore and .gitignore are independent exclusion mechanisms.
  Write-Output "Release revision: $palmRevision"
  Write-Output "Archive-only deployment directory: $palmRelease"
} finally {Pop-Location}
