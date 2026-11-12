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
 assert.match(screen,/onDayChange=\{setDay\}/);
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
 assert.match(panel,/secureIdsAvailable&&accessReady/);
 assert.match(panel,/setSecureIdsAvailable\\(newNativeFoodActionId\\(\\)!==null\\)/);
 assert.match(panel,/import \\{newNativeFoodActionId\\} from '\\.\\/fuelFoodSecureNative\\.ts'/);
 const native=source('./fuelFoodSecureNative.ts');
 assert.match(native,/import \\{randomUUID\\} from 'expo-crypto'/);
 assert.match(native,/foodActionIdFromNative\\(randomUUID\\)/);
 assert.match(panel,/This device cannot generate secure Food Log action IDs/);
 assert.match(panel,/onDayChange\(command\.replacement\.localDate\)/);
 assert.match(client,/EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED === 'true'/);
 assert.match(writer,/EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED === 'true'/);
 assert.match(writer,/result\.status===409/);
 assert.doesNotMatch(panel,/Math\.random\s*\(/);
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
 assert.match(screen,/type FoodPlanSection='plan'\|'shopping'\|'pantry'/);
 assert.match(screen,/\{id:'plan',label:'Plan'\}/);
 assert.match(screen,/\{id:'shopping',label:'Shopping'\}/);
 assert.match(screen,/\{id:'pantry',label:'Pantry'\}/);
 assert.match(screen,/selected:foodPlanSection===tab\.id/);
 assert.match(screen,/A banana, an apple and a protein bar may each be planned as separate foods/);
 assert.match(screen,/Shopping will combine missing ingredients from planned recipes with individual scheduled foods/);
 assert.match(screen,/Existing stock is not assumed empty/);
 assert.match(screen,/No days or foods have been added/);
 assert.match(screen,/No shopping cart or purchase has been created/);
 assert.doesNotMatch(screen,/create.*Shopping|write.*Shopping|addShoppingItem/);
});

test('founder build configurations do not enable unaccepted Fuel read or write features',()=>{
 const example=source('../../../.env.example');
 const eas=JSON.parse(source('../../../eas.json'));
 assert.match(example,/^EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED=false$/m);
 assert.match(example,/^EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED=false$/m);
 for(const profile of Object.values(eas.build??{})){
  const env=profile?.env??{};
  assert.notEqual(env.EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED,'true');
  assert.notEqual(env.EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED,'true');
 }
});
