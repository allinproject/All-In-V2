import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8');

test('Train Routes mounts interactive V1-derived editor, not only a saved-route placeholder',()=>{
 const container=read('../RoutesRoutinesContent.tsx');
 const builder=read('./RouteBuilderContent.tsx');
 assert.match(container,/<RouteBuilderContent \/>/);
 assert.match(builder,/<RouteMapCanvas /);
 for (const action of ['setRouteEndpoint','addRouteWaypoint','moveRouteWaypoint',
   'reorderRouteWaypoint','deleteRouteWaypoint','shapeRouteWithFreehand',
   'undoRouteEdit','redoRouteEdit','setRouteShape']) assert.match(builder,new RegExp(action));
});
test('V2 editor has no legacy persistence writes or unapproved OSM tile hotlink',()=>{
 const builder=read('./RouteBuilderContent.tsx');
 const canvas=read('./RouteMapCanvas.tsx');
 const logic=read('./trainingRouteEditor.ts');
 for (const source of [builder,canvas,logic]) {
   assert.doesNotMatch(source,/allin_training_routes|allin_save_training_route|allin_training_plan_route_attachments/);
   assert.doesNotMatch(source,/https:\/\/tile\.openstreetmap\.org/);
 }
 assert.match(builder,/This draft is not saved or synced/);
 assert.match(canvas,/EXPO_PUBLIC_V2_ROUTE_TILE_URL_TEMPLATE/);
 assert.match(canvas,/tileUrl\(t\.z,t\.x,t\.y\)/);
});
test('route view never calls provider data verified if editing invalidated it',()=>{
 const builder=read('./RouteBuilderContent.tsx');
 assert.match(builder,/draft\.routeFresh && draft\.route/);
 assert.match(builder,/Not calculated — map changes invalidate earlier measurements/);
 assert.match(builder,/geometry=\{cleanGeometry\}/);
});

test('Train and workspace switching preserve the in-session route draft without exposing hidden editor',()=>{
 const train=read('../../../app/train.tsx');
 const workspace=read('../RoutesRoutinesContent.tsx');
 assert.match(train,/display:activeTab === 'routes_routines' \? 'flex' : 'none'/);
 assert.match(train,/importantForAccessibility=\{activeTab === 'routes_routines' \? 'auto' : 'no-hide-descendants'\}/);
 assert.match(workspace,/selected !== 'routes' && styles.hidden/);
 assert.match(workspace,/importantForAccessibility=\{selected === 'routes' \? 'auto' : 'no-hide-descendants'\}/);
 assert.match(workspace,/<RouteBuilderContent \/>/);
});
