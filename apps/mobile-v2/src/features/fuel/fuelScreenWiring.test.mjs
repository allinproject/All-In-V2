import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=relative=>readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');

test('existing Fuel route owns the three approved sections and preserves Today day',()=>{
 const screen=source('../../../app/fuel.tsx');
 assert.match(screen,/parseFuelDayContext\(params\.date, params\.section\)/);
 assert.match(screen,/\{id:'food-log',label:'Food Log'\}/);
 assert.match(screen,/\{id:'recipes',label:'Recipes'\}/);
 assert.match(screen,/\{id:'food-plan',label:'Food Plan'\}/);
 assert.match(screen,/FuelFoodLogPanel ownerId=\{user\.id\} day=\{day\}/);
 assert.match(screen,/v2AuthenticatedScreenKey\(user\?\.id\?\?null,sessionGeneration\)/);
 assert.match(screen,/gate\.status==='ready'/);
 assert.match(screen,/V2BottomNavigation/);
 assert.doesNotMatch(screen,/v2_fuel_food_entries_candidate/);
});

test('Food Log uses only the approved owner-guarded RPC and no shadow store',()=>{
 const panel=source('./FuelFoodLogPanel.tsx');
 const client=source('./fuelOwnerFoodClient.ts');
 const writer=source('./fuelOwnerFoodWrite.ts');
 assert.match(panel,/readOwnedFuelDayPayload\(supabase,ownerId,day,/);
 assert.match(panel,/editableFoodDay\(payload,ownerId,day\)/);
 assert.match(panel,/writeOwnedManualFood\(supabase,command,/);
 assert.match(panel,/V2_FUEL_MANUAL_WRITE_ENABLED&&V2_FUEL_DAY_READ_ENABLED/);
 assert.match(panel,/foodRefreshRevision|setRefresh\(r=>r\+1\)/);
 assert.match(panel,/pending\.current=/);
 assert.match(panel,/confirmDelete/);
 assert.match(client,/EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED === 'true'/);
 assert.match(writer,/EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED === 'true'/);
 assert.match(writer,/result\.status===409/);
 assert.doesNotMatch(panel,/Math\.random/);
 assert.doesNotMatch(panel,/AsyncStorage/);
});

test('Food Log never fabricates nutrition totals or meal photos',()=>{
 const panel=source('./FuelFoodLogPanel.tsx');
 assert.match(panel,/Nutrition totals are not connected yet/);
 assert.match(panel,/Calories unknown/);
 assert.match(panel,/Calories \(optional, only if known\)/);
 assert.match(panel,/No entries in the verified log/);
 assert.doesNotMatch(panel,/https:\/\/.*\.(?:jpg|png)/);
});

test('Recipes and Food Plan do not mutate an unconnected meal plan',()=>{
 const screen=source('../../../app/fuel.tsx');
 assert.match(screen,/Cook Now/);
 assert.match(screen,/Each recipe is one serving/);
 assert.match(screen,/Plan · Shopping · Pantry/);
 assert.match(screen,/Nothing has been added to a meal plan or shopping list/);
});
