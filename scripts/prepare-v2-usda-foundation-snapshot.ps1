<#
.SYNOPSIS
  Download and verify the official USDA Foundation Foods October 2026 archive.
.DESCRIPTION
  SOURCE ACQUISITION ONLY for ALL-228. No extraction of food records,
  database imports, SQL, network uploads, deployment, or publication.
  DestinationDirectory is explicit so large archives are not silently stored
  in the Git checkout. Never assume a previous ZIP's checksum.
.EXAMPLE
  .\scripts\prepare-v2-usda-foundation-snapshot.ps1 -DestinationDirectory "$env:USERPROFILE\Downloads\ALL-IN-365-USDA"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DestinationDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceUrl = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-10-29.zip'
$sourceName = 'FoodData_Central_foundation_food_json_2026-10-29.zip'
$manifestName = 'foundation-2026-10-29-manifest.json'

$target = [System.IO.Path]::GetFullPath($DestinationDirectory)
$repoRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if ($target.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $target.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'USDA archive destination must be outside the Git repository to avoid accidentally tracking source ZIPs.'
}
if (-not [System.IO.Directory]::Exists($target)) {
  [System.IO.Directory]::CreateDirectory($target) | Out-Null
}
$zipPath = [System.IO.Path]::Combine($target, $sourceName)
$manifestPath = [System.IO.Path]::Combine($target, $manifestName)
$partialPath = [System.IO.Path]::Combine($target, "$sourceName.partial")

if ((Test-Path -LiteralPath $partialPath)) {
  throw "A partial archive already exists at $partialPath. Inspect and remove it manually before retrying."
}
if (-not (Test-Path -LiteralPath $zipPath)) {
  try {
    Write-Host "Downloading official USDA Foundation Foods source to $partialPath"
    Invoke-WebRequest -Uri $sourceUrl -OutFile $partialPath -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $partialPath) -or (Get-Item -LiteralPath $partialPath).Length -lt 1000) {
      throw 'Download was empty or unexpectedly short.'
    }
    # The move occurs only once download succeeds; content validation follows.
    [System.IO.File]::Move($partialPath, $zipPath)
  } catch {
    if (Test-Path -LiteralPath $partialPath) {
      Remove-Item -LiteralPath $partialPath -Force
    }
    throw
  }
} else {
  Write-Host 'Reusing existing archive for read-only verification; no source bytes will be overwritten.'
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $members = @($zip.Entries | ForEach-Object {
    [ordered]@{
      name = $_.FullName
      uncompressed_bytes = $_.Length
      compressed_bytes = $_.CompressedLength
    }
  })
  if ($members.Count -eq 0 -or $members.Count -gt 2000) {
    throw 'Archive member count is missing or excessive; cannot establish a valid USDA snapshot.'
  }
  $seenMembers = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $hasJson = $false
  foreach ($member in $members) {
    $name = [string]$member.name
    $parts = $name.Split('/')
    if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith('/') -or
        $name.StartsWith('\\') -or $name.Contains('\\') -or
        $name -match '^[A-Za-z]:' -or
        $name -match '[\\x00-\\x1F]' -or
        $parts -contains '.' -or $parts -contains '..' -or
        -not $seenMembers.Add($name)) {
      throw "Unsafe or duplicate ZIP member metadata: $name"
    }
    if ($name.ToLowerInvariant().EndsWith('.json') -and $member.uncompressed_bytes -gt 0) {
      $hasJson = $true
    }
  }
  if (-not $hasJson) {
    throw 'USDA source archive must include a nonempty JSON member.'
  }
} finally {
  $zip.Dispose()
}

$archive = Get-Item -LiteralPath $zipPath
$sha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  source = 'USDA FoodData Central'
  data_type = 'Foundation Foods'
  release_date = '2026-10-29'
  official_download_url = $sourceUrl
  archive_filename = $sourceName
  archive_bytes = $archive.Length
  archive_sha256 = $sha
  archive_members = $members
  verified_at_utc = [DateTime]::UtcNow.ToString('o')
  phase = 'source_archive_only_not_imported_not_reviewed'
}
if (Test-Path -LiteralPath $manifestPath) {
  throw "Manifest already exists at $manifestPath. Move it aside before creating a new provenance record."
}
$json = $manifest | ConvertTo-Json -Depth 8
$temporaryManifest = "$manifestPath.partial"
if (Test-Path -LiteralPath $temporaryManifest) {
  throw "A temporary manifest already exists at $temporaryManifest."
}
try {
  [System.IO.File]::WriteAllText($temporaryManifest, $json, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::Move($temporaryManifest, $manifestPath)
} catch {
  if (Test-Path -LiteralPath $temporaryManifest) {
    Remove-Item -LiteralPath $temporaryManifest -Force
  }
  throw
}
Write-Host "Verified archive SHA-256: $sha"
Write-Host "Archive members: $($members.Count)"
Write-Host "Manifest created: $manifestPath"
Write-Host 'No ingredients were imported, approved, published, or deployed.'
