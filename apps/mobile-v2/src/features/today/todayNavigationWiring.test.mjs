import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('Today preserves five-section order and four compact verified food tiles', () => {
  const home = source('../../../app/home.tsx');
  const sections = [">Today's Training</Text>", '>Daily Energy</Text>', '>Food Log</Text>', '>Progress</Text>', '>Recovery</Text>'];
  const offsets = sections.map(section => home.indexOf(section));
  assert.ok(offsets.every(position => position >= 0));
  assert.deepEqual(offsets, [...offsets].sort((a,b) => a-b));
  for (const heading of ['Daily Energy','Food Log','Progress','Recovery']) {
    assert.ok(home.includes(`<Text accessibilityRole="header" style={styles.sectionTitle}>${heading}</Text>`),
      `missing accessible Today heading: ${heading}`);
  }
  assert.match(home, /foodLog\.visible\.map\(row => \(/);
  assert.match(home, /<Link key=\{row\.id\} href=\{foodLogDestination\} asChild>/);
  assert.match(home, /accessibilityLabel=\{`View \$\{row\.label\} in this day's Food Log`\}/);
  assert.match(home, /foodTile: \{\s*width: '22%', maxWidth: 88/);
  assert.match(home, /source=\{\{ uri: row\.photoUri \}\}/);
  assert.match(home, /foodPhotoFallback/);
  // Four compact 22% columns + three 8px gaps fit narrow mobile cards.
  for (const innerWidth of [224, 240, 248, 260, 300]) {
    assert.ok(4 * Math.min(innerWidth * 0.22, 88) + 3 * 8 <= innerWidth,
      `four photo tiles overflow ${innerWidth}px card`);
  }
  const model = source('./todayFoodLog.ts');
  assert.match(model, /ordered\.slice\(0, 4\)/);
  assert.match(model, /additionalCount: Math\.max\(0, ordered\.length - 4\)/);
  assert.match(model, /photo\.status !== 'verified'/);
});

test('Today distinct Daily Extended and Food Log links preserve the date', () => {
  const home = source('../../../app/home.tsx');
  assert.match(home, /pathname: '\/daily-extended' as const, params: \{ date: localDay \}/);
  assert.match(home, /todayFuelDestination\(localDay, 'food-log'\)/);
  assert.match(home, /href=\{dailyDestination\}/);
  assert.match(home, /href=\{foodLogDestination\}/);
  assert.match(source('../../../app/fuel.tsx'), /parseFuelDayContext\(params\.date, params\.section\)/);
});

test('Today never presents unavailable domain data as accepted athlete facts', () => {
  const home = source('../../../app/home.tsx');
  assert.match(home, /planned: \{ status: 'unavailable' \}/);
  assert.match(home, /completed: \{ status: 'unavailable' \}/);
  assert.match(home, /todayEnergyGlance\(\{ status: 'unavailable' \}/);
  // ALL-247 may display a complete verified owner day only when the explicit
  // read flag and access gate allow it. Before launch, failure remains unknown.
  assert.match(home, /todayFoodLog\(foodEvidence,/);
  assert.match(home, /!V2_FUEL_DAY_READ_ENABLED \|\| gate\.status !== 'ready'/);
  assert.match(home, /setFoodEvidence\(\{status:'unavailable'\}\)/);
  assert.match(home, /readOwnedFuelDay\(supabase,user\.id,localDay,/);
  // A same-day Fuel mutation must be reflected after Today regains focus;
  // a foreground transition similarly invalidates cached owner evidence.
  assert.match(home, /setFoodRefreshRevision\(value => value \+ 1\)/);
  assert.match(home, /foodRefreshRevision\]\)/);
  assert.match(home, /if \(shouldRefreshTodayOnAppState\(state\)\)/);
  const client = source('../fuel/fuelOwnerFoodClient.ts');
  assert.match(client, /EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED === 'true'/);
  assert.match(client, /await services\.authenticateOwner\(\)/);
  assert.match(home, /todayKitchenDue\(\{status:'unavailable'\}/);
  assert.ok(home.includes("todayWeatherGlance({status:'unavailable'}"));
  assert.ok(home.includes('{weatherGlance.label}'));
});
