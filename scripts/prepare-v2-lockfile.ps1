# Local-only V2 lockfile and install checkpoint. Run from Windows PowerShell.
# Does not deploy, push, create PRs, or commit files.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mobileDir = Join-Path $repoRoot 'apps/mobile-v2'
$packagePath = Join-Path $mobileDir 'package.json'
$lockPath = Join-Path $mobileDir 'package-lock.json'
$guard = Join-Path $PSScriptRoot 'check-v2-dependency-manifest.mjs'

function Invoke-Checked([string]$Step, [string]$Exe, [string[]]$Arguments) {
    Write-Host ">>> $Step" -ForegroundColor Cyan
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed (exit code $LASTEXITCODE). No changes were committed or pushed."
    }
}

if (-not (Test-Path $packagePath) -or -not (Test-Path $guard)) {
    throw 'Run this script from a complete All-In-V2 checkout.'
}

$branch = (& git -C $repoRoot branch --show-current)
if ($LASTEXITCODE -ne 0 -or $branch.Trim() -ne 'integration/v2-foundation') {
    throw 'Refusing to prepare a V2 lockfile outside integration/v2-foundation.'
}
$existingChanges = (& git -C $repoRoot status --porcelain -- 'apps/mobile-v2/package.json' 'apps/mobile-v2/package-lock.json')
if ($LASTEXITCODE -ne 0 -or $existingChanges) {
    throw 'Package manifest or lockfile already has local changes. Review them before rerunning.'
}
if (Test-Path $lockPath) {
    throw 'A canonical package-lock.json already exists. Use the documented npm ci validation instead.'
}

$nodeVersionText = (& node.exe --version)
if ($LASTEXITCODE -ne 0) { throw 'Node.js is required.' }
$nodeVersion = [version]($nodeVersionText.TrimStart('v'))
if ($nodeVersion -lt [version]'22.13.0') {
    throw 'Node.js 22.13.0 or later is required.'
}
Write-Host "Node $nodeVersionText; npm from npm.cmd; branch $branch"

Push-Location $mobileDir
try {
    Invoke-Checked 'Resolve canonical npm lockfile' 'npm.cmd' @('install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund')
    Invoke-Checked 'Validate exact lockfile contract' 'node.exe' @($guard, '--require-lockfile')
    Invoke-Checked 'Verify reproducible clean install' 'npm.cmd' @('ci', '--no-audit', '--no-fund')
    Invoke-Checked 'Auth tests' 'npm.cmd' @('run', 'test:auth')
    Invoke-Checked 'Cookbook tests' 'npm.cmd' @('run', 'test:calculator')
    Invoke-Checked 'Training tests' 'npm.cmd' @('run', 'test:training-logic')
    Invoke-Checked 'TypeScript check' 'npm.cmd' @('run', 'typecheck')
    Write-Host 'PASS: V2 lockfile, npm ci, unit tests, TypeScript.' -ForegroundColor Green
    Write-Host "Review and commit only after inspecting: $lockPath"
    Write-Host 'This script intentionally does not commit, push, deploy or run paid CI.'
} finally {
    Pop-Location
}
