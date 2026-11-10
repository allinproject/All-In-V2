import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const script = readFileSync(fileURLToPath(
  new URL('./prepare-v2-usda-foundation-snapshot.ps1', import.meta.url),
), 'utf8');

test('USDA source helper pins official Foundation October 2026 JSON archive', () => {
  assert.match(script, /https:\/\/fdc\.nal\.usda\.gov\/fdc-datasets\/FoodData_Central_foundation_food_json_2026-10-29\.zip/);
  assert.match(script, /\[Parameter\(Mandatory = \$true\)\]/);
  assert.match(script, /\$DestinationDirectory/);
  assert.match(script, /\$target\.StartsWith\(\$repoPrefix/);
  assert.match(script, /outside the Git repository/);
});

test('source helper verifies actual archive bytes, ZIP structure and SHA256', () => {
  assert.match(script, /Invoke-WebRequest -Uri \$sourceUrl -OutFile \$partialPath/);
  assert.match(script, /\[System\.IO\.Compression\.ZipFile\]::OpenRead\(\$zipPath\)/);
  assert.match(script, /Get-FileHash -LiteralPath \$zipPath -Algorithm SHA256/);
  assert.match(script, /archive_bytes = \$archive\.Length/);
  assert.match(script, /archive_sha256 = \$sha/);
  assert.match(script, /archive_members = \$members/);
  assert.match(script, /source_archive_only_not_imported_not_reviewed/);
});

test('source acquisition refuses unsafe ZIP inventory before manifest publication', () => {
  assert.match(script, /\$seenMembers = \[System\.Collections\.Generic\.HashSet\[string\]\]::new/);
  assert.match(script, /\$parts -contains '\.\.'/);
  assert.match(script, /\$parts -contains '\.'/);
  assert.match(script, /\-not \$seenMembers\.Add\(\$name\)/);
  assert.match(script, /\$name\.StartsWith\('\/'\)/);
  assert.match(script, /\$name\.Contains/);
  assert.match(script, /\$hasJson = \$true/);
  assert.match(script, /if \(\-not \$hasJson\)/);
  assert.match(script, /nonempty JSON member/);
});

test('helper cannot overwrite a source snapshot or publish nutrition', () => {
  assert.match(script, /if \(Test-Path -LiteralPath \$manifestPath\)/);
  assert.match(script, /if \(-not \(Test-Path -LiteralPath \$zipPath\)\)/);
  assert.match(script, /Set-StrictMode -Version Latest/);
  assert.match(script, /\$ErrorActionPreference = 'Stop'/);
  assert.doesNotMatch(script, /^\s*(?:&\s*)?(?:supabase|psql|git|gh|eas)(?:\.exe|\.cmd)?\s+(?:push|commit|deploy|db\s+push|migration|sql|release)/im);
  assert.doesNotMatch(script, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|CREATE\s+TABLE)\b/i);
});
